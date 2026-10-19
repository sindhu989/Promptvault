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
    throw new Error(`EmailJS returned HTTP ${response.status}.`)
  }
}

module.exports = { sendPasswordResetEmail }
