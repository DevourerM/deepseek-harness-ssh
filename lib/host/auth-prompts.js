const OTP_PROMPT = /\b(?:2nd|second|otp|totp|verification|token|passcode|2fa|mfa)\b|one[\s-]*time|二次密码|第二密码|验证码|动态|一次性|安全码|令牌/i;
const PASSWORD_PROMPT = /password|passphrase|密码|口令/i;

export const isOtpPrompt = text => OTP_PROMPT.test(text || '');
export const isPasswordPrompt = text => PASSWORD_PROMPT.test(text || '') && !isOtpPrompt(text);
