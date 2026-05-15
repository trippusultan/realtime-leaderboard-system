/** Express error handler — sends { success:false, error, message, details? } */
export default function errorHandler(err, req, res, _next) {
  console.error("[error]", err.message, err.stack || "");

  const known = err.statusCode
    || (err.type ? Object.freeze({ exists: true, statusCode: 400 }) : null)?.statusCode
    || 500;

  const payload = {
    success: false,
    error:   err.code   || httpStatus(known),
    message: err.message || "Internal Server Error",
  };
  if (err.details) payload.details = err.details;
  res.status(known).json(payload);
}

function httpStatus(code) {
  const map = {
    400: "BAD_REQUEST", 401: "UNAUTHORIZED", 403: "FORBIDDEN",
    404: "NOT_FOUND",   409: "CONFLICT",       500: "INTERNAL_ERROR",
  };
  return map[code] || "ERROR";
}
