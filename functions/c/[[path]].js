import { renderPublicSharePage } from "../lib/certificate.js";

export async function onRequest(context) {
  const { request, env, params } = context;
  const raw = params && params.path ? String(params.path) : "";
  const id = raw.split("/").filter(Boolean)[0] || "";
  if (!id) {
    return Response.redirect("https://dreamint.it/", 302);
  }
  try {
    return await renderPublicSharePage(request, env, id);
  } catch (err) {
    return new Response("Errore interno", { status: 500, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
}
