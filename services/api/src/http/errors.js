function createErrorPayload(code, message, details) {
  const payload = {
    error: {
      code,
      message,
    },
  };

  if (details) {
    payload.error.details = details;
  }

  return payload;
}

function sendError(res, status, code, message, details) {
  return res.status(status).json(createErrorPayload(code, message, details));
}

module.exports = {
  createErrorPayload,
  sendError,
};
