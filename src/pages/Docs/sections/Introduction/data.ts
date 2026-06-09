import type { SectionData } from "../../types";

export const data: SectionData = {
  id: "introduction",
  label: "Overview",
  category: "getting-started",
  title: "Getting started",
  prose: `Hello and welcome to Misty!

If you're new here, this is the place to get started. The documentation is organized into sections, each covering different Misty features and concepts. If you ever find yourself stuck, please find any relevant sections or search the documentation for help as you may find a quick solution to your issue.

Now, let's run through a brief overview before we head on to other sections.

Misty is a file manager that enables you to manage your local and cloud storage through a single interface. Instead of jumping between browser tabs and separate tools, you can quickly browse, move, search, and sync your data across multiple cloud providers.

The goal of Misty is to make data management as easy, efficient, and most importantly, extensible as possible. Additionally, Misty provides a plugins marketplace such that you can create your own or find plugins that enhances your workflow. This makes Misty a versatile tool that is fully customizable to your specific needs.

In terms of architecture, Misty runs local on your machine. Now, the term "local" means that we, the Misty team, never see, share, or interact with your data. Misty uses a local proxy service that connects directly to multiple cloud providers through secure, robust authentication methods such as OAuth. Remember, your data is only shared between you and the cloud provider. By signing in to different cloud providers, you are only allowing the local proxy service to access your data on your behalf.

Besides Misty, there is a utility tool called Misty Hub which allows you to monitor and manage your Misty setup. This tool also provides an installer to install Misty and log any errors or issues that may occur during installation. Misty Hub also contains a marketplace for plugins, which will be explained more in the Plugins section.

To get started, please follow the installation steps in the next section.

If you have any questions or need help, please don't hesitate to reach out to the support team and be sure to check out our social links for updates and community support. You can also submit bug reports or feature requests in the Discord server or on our GitHub page.

We're really glad you're here! Let's strive to make Misty the best file manager!`,
  notes: [
    {
      kind: "tip",
      text: "Start with one provider first and make sure file operations feel right. Then, once you're comfortable with the basics, add the rest of your setup.",
    },
  ],
};
