const isProduction = process.env.NODE_ENV === 'production'

const userCookieName = 'promptvault_session'
const adminCookieName = 'promptvault_admin_session'

function cookieOptions(maxAge) {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    path: '/api',
    maxAge,
  }
}

function setUserCookie(res, token) {
  res.cookie(userCookieName, token, cookieOptions(7 * 24 * 60 * 60 * 1000))
}

function clearUserCookie(res) {
  res.clearCookie(userCookieName, cookieOptions())
}

function setAdminCookie(res, token) {
  res.cookie(adminCookieName, token, cookieOptions(30 * 60 * 1000))
}

function clearAdminCookie(res) {
  res.clearCookie(adminCookieName, cookieOptions())
}

module.exports = {
  userCookieName,
  adminCookieName,
  setUserCookie,
  clearUserCookie,
  setAdminCookie,
  clearAdminCookie,
}
