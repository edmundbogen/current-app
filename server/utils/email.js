const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
  host: `email-smtp.${process.env.AWS_REGION}.amazonaws.com`,
  port: 587,
  secure: false,
  auth: {
    user: process.env.AWS_ACCESS_KEY_ID,
    pass: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const FROM_EMAIL = process.env.SES_FROM_EMAIL;

async function sendWelcomeEmail(subscriberEmail, subscriberName) {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h1 style="color: #1a3e5c; border-bottom: 3px solid #00a8e1; padding-bottom: 10px;">Welcome to the Platform!</h1>
      <p style="font-size: 16px; color: #333;">Hi ${subscriberName},</p>
      <p style="font-size: 16px; color: #333;">Thanks for signing up! We're excited to help you create personalized, professional social media content for your real estate business.</p>
      <p style="font-size: 16px; color: #333;">Here's what you can do next:</p>
      <ul style="font-size: 16px; color: #333;">
        <li>Upload your headshot and logo</li>
        <li>Set your brand colors</li>
        <li>Browse and personalize content</li>
      </ul>
      <p style="font-size: 16px; color: #333;">If you need any help getting started, our VA service team is here for you.</p>
      <p style="font-size: 14px; color: #999; margin-top: 30px;">— The Team</p>
    </div>
  `;

  await transporter.sendMail({
    from: FROM_EMAIL,
    to: subscriberEmail,
    subject: 'Welcome! Let\'s get your brand set up',
    html,
  });
}

async function sendPasswordResetEmail(email, resetToken) {
  const resetUrl = `${process.env.APP_URL || 'https://app.example.com'}/reset-password?token=${resetToken}`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h1 style="color: #1a3e5c; border-bottom: 3px solid #00a8e1; padding-bottom: 10px;">Password Reset</h1>
      <p style="font-size: 16px; color: #333;">You requested a password reset. Click the link below to set a new password:</p>
      <p style="text-align: center; margin: 30px 0;">
        <a href="${resetUrl}" style="background: #00a8e1; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-size: 16px;">Reset Password</a>
      </p>
      <p style="font-size: 14px; color: #999;">If you didn't request this, you can safely ignore this email.</p>
    </div>
  `;

  await transporter.sendMail({
    from: FROM_EMAIL,
    to: email,
    subject: 'Password Reset Request',
    html,
  });
}

module.exports = { sendWelcomeEmail, sendPasswordResetEmail };
