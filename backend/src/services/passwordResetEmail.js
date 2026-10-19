async function sendPasswordResetEmail(email, name, otp) {
  const serviceId = process.env.EMAILJS_SERVICE_ID
  const templateId = process.env.EMAILJS_TEMPLATE_ID
  const publicKey = process.env.EMAILJS_PUBLIC_KEY
  const privateKey = process.env.EMAILJS_PRIVATE_KEY

  if (!serviceId || !templateId || !publicKey || !privateKey) {
    throw new Error(
      'EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, EMAILJS_PUBLIC_KEY, and EMAILJS_PRIVATE_KEY must be configured.',
    )
  }

  const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id: serviceId,
      template_id: templateId,
      user_id: publicKey,
      accessToken: privateKey,
      template_params: {
        to_email: email,
        to_name: name || 'there',
        otp,
        validity: '15 minutes',
        product_name: 'PromptVault',
      },
    }),
  })

  if (!response.ok) {
    const providerMessage = (await response.text())
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .slice(0, 500)
      .trim()
    const safeProviderMessage = [email, name, otp, serviceId, templateId, publicKey, privateKey]
      .filter((value) => typeof value === 'string' && value.length > 0)
      .reduce(
        (message, secret) => message.split(secret).join('[redacted]'),
        providerMessage,
      )
    throw new Error(
      `EmailJS returned HTTP ${response.status}${safeProviderMessage ? `: ${safeProviderMessage}` : '.'}`,
    )
  }
}

module.exports = { sendPasswordResetEmail }
