// SPDX-License-Identifier: MIT
// Records notification events for the native notification probe.
window.notificationEvents = [];
for (const name of ["onShown", "onClicked", "onButtonClicked", "onClosed"]) {
  browser.notifications[name].addListener((...args) => window.notificationEvents.push([name, ...args]));
}
window.createNotification = () =>
  browser.notifications.create("probe", {
    type: "basic",
    title: "Misty notification probe",
    message: "This test notification removes itself.",
    iconUrl: "icon.png",
    buttons: [{ title: "Yes" }, { title: "No" }],
  });
