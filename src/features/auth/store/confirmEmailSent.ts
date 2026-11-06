/** The server took a sign-up and emailed a link: the account exists once that is opened. */
export class ConfirmEmailSent extends Error {
  name = "ConfirmEmailSent";
  constructor() {
    super("Check your email to finish creating your account.");
  }
}
