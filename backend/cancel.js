/**
 * AWCA Lottery - Cancellation Handler
 * Removes the correct entry for a cancelled subscription.
 * Duplicate emails are stored as email, email(1), email(2), etc.
 */

export function handleCancellation(subscriber) {
  const { email, plan } = subscriber;

  // Backend will:
  // 1. Look up all entries matching this email
  // 2. Remove the correct numbered entry
  // 3. Log cancellation for audit
  // 4. Keep other entries if user has multiple subscriptions

  return {
    status: "pending-implementation",
    message: `Cancellation received for ${email} on plan ${plan}`
  };
}
