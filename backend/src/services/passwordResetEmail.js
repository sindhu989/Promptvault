function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character])
}

async function sendPasswordResetEmail(email, name, otp) {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.RESEND_FROM
  if (!apiKey || !from) {
    throw new Error('RESEND_API_KEY and RESEND_FROM must be configured.')
  }

  const safeName = escapeHtml(name || 'there')
  const safeOtp = escapeHtml(otp)
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: 'Reset your PromptVault password',
      text: `Hello ${name || 'there'},\n\nUse this one-time code to reset your PromptVault password:\n\n${otp}\n\nThis code expires in 15 minutes and can only be used once. If you did not request a password reset, you can ignore this email.`,
      html: `<div style="margin:0;padding:32px 16px;background:#f7f6fb;font-family:Arial,sans-serif;color:#27253a"><div style="max-width:520px;margin:0 auto;padding:36px;background:#fff;border:1px solid #ecebf2;border-radius:18px"><div style="font-size:18px;font-weight:700;color:#684be0">PromptVault</div><h1 style="margin:28px 0 12px;font-size:25px">Reset your password</h1><p style="line-height:1.6">Hi ${safeName},</p><p style="line-height:1.6">Enter this one-time code in PromptVault to choose a new password:</p><p style="margin:28px 0;padding:18px;border-radius:12px;background:#f1edff;color:#5539c9;font-size:32px;font-weight:700;letter-spacing:8px;text-align:center">${safeOtp}</p><p style="line-height:1.6;color:#77768a">This code expires in 15 minutes and can only be used once.</p><p style="line-height:1.6;color:#77768a">If you didn’t request a password reset, you can safely ignore this email.</p><p style="margin-top:28px;color:#77768a;font-size:12px">PromptVault will never ask you to share this code.</p></div></div>`,
    }),
  })

  if (!response.ok) {
    throw new Error(`Resend returned HTTP ${response.status}.`)
  }
}

module.exports = { sendPasswordResetEmail }
