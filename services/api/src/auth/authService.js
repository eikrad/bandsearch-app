const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { randomBytes } = require("crypto");

const BCRYPT_ROUNDS = 10;
const JWT_EXPIRES_IN = "30d";

function generateRecoveryCode() {
  const hex = randomBytes(20).toString("hex");
  return hex.match(/.{1,5}/g).join("-");
}

function createAuthService({ userRepository, jwtSecret }) {
  async function register({ email, displayName, password }) {
    if (!email || !email.trim()) return { ok: false, error: "email is required" };
    if (!password) return { ok: false, error: "password is required" };

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const recoveryCode = generateRecoveryCode();
    const recoveryCodeHash = await bcrypt.hash(recoveryCode, BCRYPT_ROUNDS);

    let user;
    try {
      user = await userRepository.create({ email, displayName, passwordHash, recoveryCodeHash });
    } catch (err) {
      return { ok: false, error: err.message };
    }

    const token = jwt.sign({ sub: user.id }, jwtSecret, { expiresIn: JWT_EXPIRES_IN });
    return { ok: true, user, token, recoveryCode };
  }

  async function login({ email, password }) {
    const user = await userRepository.findByEmail(email);
    if (!user) return { ok: false, error: "invalid credentials" };

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return { ok: false, error: "invalid credentials" };

    const { passwordHash: _ph, recoveryCodeHash: _rc, ...publicUser } = user; // eslint-disable-line no-unused-vars
    const token = jwt.sign({ sub: user.id }, jwtSecret, { expiresIn: JWT_EXPIRES_IN });
    return { ok: true, user: publicUser, token };
  }

  function verifyToken(token) {
    try {
      const payload = jwt.verify(token, jwtSecret);
      return { ok: true, userId: payload.sub };
    } catch {
      return { ok: false, error: "invalid token" };
    }
  }

  async function resetPassword({ email, recoveryCode, newPassword }) {
    const user = await userRepository.findByEmail(email);
    if (!user) return { ok: false, error: "invalid recovery code" };

    const match = await bcrypt.compare(recoveryCode, user.recoveryCodeHash);
    if (!match) return { ok: false, error: "invalid recovery code" };

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    const newRecoveryCode = generateRecoveryCode();
    const recoveryCodeHash = await bcrypt.hash(newRecoveryCode, BCRYPT_ROUNDS);

    await userRepository.updatePassword(user.id, { passwordHash, recoveryCodeHash });
    return { ok: true, newRecoveryCode };
  }

  return { register, login, verifyToken, resetPassword };
}

module.exports = { createAuthService };
