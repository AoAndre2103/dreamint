import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const api = readFileSync(new URL('../functions/api/[[path]].js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../migrate-v28.sql', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
test('external ungraded transfer requires recipient claim and owner approval', () => {
 assert.match(api, /raw_external_transfers SET status='claimed'/);
 assert.match(api, /raw_external_transfers SET status='completed'/);
 assert.match(api, /recipient_id IS NOT NULL/);
 assert.match(api, /physical_owner_id=\?, digital_owner_id=\?/);
 assert.match(api, /is_ungraded=1 AND archived_at IS NULL/);
});
test('codes are hashed, expire and cannot be used twice', () => {
 assert.match(api, /crypto\.subtle\.digest\("SHA-256"/);
 assert.match(api, /RAW_TRANSFER_TTL = 15 \* 60 \* 1000/);
 assert.match(api, /code_hash=\? AND status='pending' AND expires_at > \?/);
 assert.match(migration, /code_hash TEXT NOT NULL UNIQUE/);
});
test('open sales and listings prevent off-platform transfer', () => {
 assert.match(api, /RAW_OPEN_SALES/);
 assert.match(api, /RAW_OPEN_LISTINGS/);
 assert.match(api, /NOT EXISTS \(SELECT 1 FROM sales WHERE slab_id=raw_external_transfers\.slab_id/);
});
test('open disputes prevent manual and automatic completion', () => {
 assert.match(api, /if \(!blocked && shouldAutoComplete/);
 assert.match(api, /status = 'completed'.*NOT EXISTS \(SELECT 1 FROM sale_disputes/);
 assert.match(migration, /idx_sale_disputes_one_open/);
});
test('album exposes redemption and card exposes owner approval', () => {
 assert.match(ui, /raw-transfer-redeem/);
 assert.match(ui, /raw-transfer-create/);
 assert.match(ui, /raw-approve/);
 assert.match(ui, /data-dispute/);
});
