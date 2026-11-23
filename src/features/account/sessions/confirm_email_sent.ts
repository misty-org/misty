export class ConfirmEmailSent extends Error {
  name = "ConfirmEmailSent";
  constructor() {
    super("Check your email to finish creating your account.");
  }
}
