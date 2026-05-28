import { decode, DecodeError } from "google-news-url-decoder";

export default {
  async fetch(request: Request): Promise<Response> {
    const target = new URL(request.url).searchParams.get("u");
    if (!target) return new Response("missing ?u=", { status: 400 });
    try {
      const decoded = await decode(target);
      return Response.json({ url: decoded });
    } catch (err) {
      if (err instanceof DecodeError) {
        return Response.json({ error: err.kind, message: err.message }, { status: 502 });
      }
      throw err;
    }
  },
};
