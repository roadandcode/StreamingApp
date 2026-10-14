/**
 * DISPLAY PRICES (INR) — TO BE CONFIGURED.
 *
 * The API does not return prices, and the amount actually charged is whatever the Razorpay plan
 * (`plan_id`) is set up with. Fill in the price label for each plan code here once the Razorpay plans
 * exist, keeping them identical to the Razorpay dashboard, e.g. `premium_monthly: "₹___ / month"`.
 *
 * Plans without an entry show "Price shown at checkout".
 */
export const PLAN_PRICE_LABELS_INR: Readonly<Record<string, string>> = {
  // premium_monthly: "",
  // premium_yearly: "",
};
