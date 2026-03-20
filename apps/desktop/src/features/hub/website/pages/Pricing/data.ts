export const freeFeatures = [
  "Connect up to 2 cloud providers",
  "Browse, upload, download, move, and organize cloud files from one place",
  "Run background transfers across your connected providers without blocking your workflow",
  "Use unified search to find files faster across the providers you have connected",
];

export const personalFeatures = [
  "Everything in Free",
  "Up to 5 devices",
  "Unlimited cloud providers",
  "Access to the plugins ecosystem",
  "AI file workflows, including summarization and more",
  "Shared clipboard access across your local devices",
  "Encrypted backups for your files with vault",
];

export const unlimitedFeatures = [
  "Everything in Personal",
  "Unlimited devices",
  "Generate device licenses on demand",
  "Best fit for power users with no device ceiling",
  "Incremental updates with access to new beta features",
];

export type PricingFaq = {
  q: string;
  a: string;
};

export const pricingFaqs: PricingFaq[] = [
  {
    q: "Is there a free plan?",
    a: "Yes. Free is available permanently and lets you connect up to 2 cloud providers for core file management, background transfers, and unified search. You can get started without entering payment details.",
  },
  {
    q: "Can I trial Personal first?",
    a: "Yes. Personal can be tried before purchase so you can verify the workflow, connected providers, and multi-device setup before upgrading.",
  },
  {
    q: "Is this a one-time purchase?",
    a: "Yes. Personal and Unlimited are perpetual licenses. You pay once, keep the access you bought, and get future updates without a subscription.",
  },
  {
    q: "How many devices does Personal cover?",
    a: "Personal covers up to 5 of your devices. That can include laptops, desktops, or servers you actively use. Unlimited removes the device cap entirely.",
  },
  {
    q: "What's the difference between Personal and Unlimited?",
    a: "Personal is $25 and includes up to 5 devices, the plugin ecosystem, AI file workflows, Vault backups, and the shared LAN Misty clipboard. Unlimited is $89, removes the device cap, adds premium support during PST work hours, and gets faster incremental bug-fix updates.",
  },
  {
    q: "What if I get a new computer?",
    a: "You can move your Personal access across up to 5 devices as your setup changes. If you never want to think about device limits, Unlimited is the better fit.",
  },
  {
    q: "What kind of support comes with Unlimited?",
    a: "Unlimited includes premium support with coverage during work hours, plus faster incremental updates when bugs or rough edges need to be addressed quickly.",
  },
  {
    q: "How does Misty handle my data?",
    a: "Misty never touches your files. All communication with cloud providers happens through a local proxy running on your machine. Your credentials and file data never leave your device.",
  },
];
