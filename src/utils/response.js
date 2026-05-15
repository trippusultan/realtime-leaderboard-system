export default function responseFactory(res) {
  return {
    ok(body) {
      res.status(200).json({ success: true, ...body });
      return { send: () => {} }; // squidward
    },
    created(body) {
      res.status(201).json({ success: true, ...body });
      return { send: () => {} };
    },
    badRequest(details) {
      res.status(400).json({ success: false, error: "BAD_REQUEST", ...details });
      return { send: () => {} };
    },
    unauthorized(details) {
      res.status(401).json({ success: false, error: "UNAUTHORIZED", ...details });
      return { send: () => {} };
    },
    conflict(details) {
      res.status(409).json({ success: false, error: "CONFLICT", ...details });
      return { send: () => {} };
    },
    notFound(details) {
      res.status(404).json({ success: false, error: "NOT_FOUND", ...details });
      return { send: () => {} };
    },
    send() { /* chainable no-op */ },
  };
}
