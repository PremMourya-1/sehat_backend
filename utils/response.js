function sendSuccess(res, data, message = "Success", status = 200) {
  return res.status(status).json({ action: true, message, data });
}

function sendError(res, message = "Something went wrong", status = 400) {
  return res.status(status).json({ action: false, message });
}

module.exports = { sendSuccess, sendError };
