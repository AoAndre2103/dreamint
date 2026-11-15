// v36 — relazioni tra collezionisti e notifiche in-app per nuove carte pubblicate.
// Le notifiche non espongono mai album privati, carte in verifica o carte di test.
import { USERNAME_RE } from './usernames.js';

const noCache = { 'cache-control': 'no-store' };
const answer = (data, status = 200) => Response.json(data, { status, headers: noCache });
const visible = `s.status IN ('approved','listed') AND s.archived_at IS NULL
  AND s.is_test = 0 AND s.physical_owner_id = n.actor_id
  AND u.album_public = 1 AND u.is_test = 0 AND u.username IS NOT NULL`;
const safeUsername = (raw) => {
  try {
    const name = decodeURIComponent(raw).trim().toLowerCase();
    return USERNAME_RE.test(name) ? name : null;
  } catch { return null; }
};

export async function handleSocialRoutes(request, env, method, path, url, { getUser, requireUser }) {
  const target = path.match(/^users\/([^/]+)\/follow$/);
  if (target && ['GET', 'POST', 'DELETE'].includes(method)) {
    const username = safeUsername(target[1]);
    if (!username) return answer({ error: 'Utente non trovato' }, 404);
    const user = await env.DB.prepare('SELECT id, username, album_public FROM users WHERE lower(username) = ? AND username IS NOT NULL')
      .bind(username).first();
    if (!user) return answer({ error: 'Utente non trovato' }, 404);
    const viewer = method === 'GET' ? await getUser(request, env) : await requireUser(request, env);
    const isSelf = !!(viewer && viewer.id === user.id);
    if (method !== 'GET' && isSelf) return answer({ error: 'Non puoi seguire te stesso' }, 400);
    if (method === 'POST') {
      const current = await env.DB.prepare('SELECT COUNT(*) AS n FROM user_follows WHERE follower_id = ?').bind(viewer.id).first();
      if (Number(current?.n) >= 500) {
        const exists = await env.DB.prepare('SELECT 1 AS ok FROM user_follows WHERE follower_id = ? AND followed_id = ?')
          .bind(viewer.id, user.id).first();
        if (!exists) return answer({ error: 'Limite di 500 profili seguiti raggiunto' }, 409);
      }
      await env.DB.prepare('INSERT OR IGNORE INTO user_follows (follower_id, followed_id, created_at) VALUES (?, ?, ?)')
        .bind(viewer.id, user.id, new Date().toISOString()).run();
    }
    if (method === 'DELETE') {
      // Quando smetti di seguire, spariscono anche le notifiche di quel profilo.
      await env.DB.batch([
        env.DB.prepare('DELETE FROM user_follows WHERE follower_id = ? AND followed_id = ?').bind(viewer.id, user.id),
        env.DB.prepare('DELETE FROM follow_notifications WHERE recipient_id = ? AND actor_id = ?').bind(viewer.id, user.id)
      ]);
    }
    const following = viewer && !isSelf
      ? await env.DB.prepare('SELECT 1 AS ok FROM user_follows WHERE follower_id = ? AND followed_id = ?').bind(viewer.id, user.id).first()
      : null;
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM user_follows WHERE followed_id = ?').bind(user.id).first();
    return answer({ username: user.username, following: !!following, is_self: isSelf,
      followers_count: Number(count?.n || 0), album_public: !!user.album_public });
  }

  if (method === 'GET' && path === 'me/following') {
    const viewer = await requireUser(request, env);
    const rows = await env.DB.prepare(`SELECT u.username, u.album_public FROM user_follows f
      JOIN users u ON u.id = f.followed_id WHERE f.follower_id = ? AND u.username IS NOT NULL
      ORDER BY lower(u.username) LIMIT 500`).bind(viewer.id).all();
    return answer({ users: (rows.results || []).map(r => ({ username: r.username, private: !r.album_public })) });
  }

  if (method === 'GET' && path === 'me/notifications') {
    const viewer = await requireUser(request, env);
    const joins = `FROM follow_notifications n JOIN slabs s ON s.id = n.card_id
      JOIN card_models m ON m.id = s.card_model_id JOIN users u ON u.id = n.actor_id
      JOIN user_follows f ON f.follower_id = n.recipient_id AND f.followed_id = n.actor_id`;
    const where = `WHERE n.recipient_id = ? AND n.kind = 'new_card' AND ${visible}`;
    const rows = await env.DB.prepare(`SELECT n.id, n.created_at, n.read_at, s.id AS card_id,
      m.name AS card_name, m.set_name, m.code_printed, u.username AS actor_username ${joins} ${where}
      ORDER BY n.created_at DESC, n.id DESC LIMIT 50`).bind(viewer.id).all();
    const pending = await env.DB.prepare(`SELECT COUNT(*) AS n ${joins} ${where} AND n.read_at IS NULL`).bind(viewer.id).first();
    return answer({ notifications: rows.results || [], unread_count: Number(pending?.n || 0) });
  }

  if (method === 'POST' && path === 'me/notifications/read') {
    const viewer = await requireUser(request, env);
    await env.DB.prepare(`UPDATE follow_notifications SET read_at = ?
      WHERE recipient_id = ? AND read_at IS NULL AND EXISTS (
        SELECT 1 FROM slabs s JOIN users u ON u.id = follow_notifications.actor_id
        JOIN user_follows f ON f.follower_id = follow_notifications.recipient_id AND f.followed_id = follow_notifications.actor_id
        WHERE s.id = follow_notifications.card_id AND s.status IN ('approved','listed')
          AND s.archived_at IS NULL AND s.is_test = 0 AND s.physical_owner_id = follow_notifications.actor_id
          AND u.album_public = 1 AND u.is_test = 0)`)
      .bind(new Date().toISOString(), viewer.id).run();
    return answer({ ok: true, unread_count: 0 });
  }
  return null;
}

// Invocare SOLO dopo la prima approvazione della carta, mai al semplice upload.
export async function notifyFollowersNewCard(env, slabId) {
  const result = await env.DB.prepare(`INSERT OR IGNORE INTO follow_notifications
    (id, recipient_id, actor_id, card_id, kind, created_at)
    SELECT lower(hex(randomblob(16))), f.follower_id, s.physical_owner_id, s.id, 'new_card', ?
    FROM slabs s JOIN users u ON u.id = s.physical_owner_id
    JOIN user_follows f ON f.followed_id = s.physical_owner_id
    WHERE s.id = ? AND s.status IN ('approved','listed') AND s.archived_at IS NULL
      AND s.is_test = 0 AND u.is_test = 0 AND u.album_public = 1 AND u.username IS NOT NULL AND f.follower_id <> s.physical_owner_id`)
    .bind(new Date().toISOString(), slabId).run();
  return Number(result.meta?.changes || 0);
}
