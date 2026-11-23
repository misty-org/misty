(function () {
  "use strict";
  var nextId = 1;
  var pending = new Map();
  var port = null;
  var ready = new Promise(function (resolve) {
    window.addEventListener("message", function onStart(event) {
      var data = event.data;
      if (event.source !== window.parent || !data || data.type !== "misty:init" || !event.ports[0]) return;
      window.removeEventListener("message", onStart);
      port = event.ports[0];
      port.onmessage = function (message) {
        var frame = message.data;
        if (!frame || frame.t !== "res") return;
        var call = pending.get(frame.id);
        if (!call) return;
        pending.delete(frame.id);
        if (frame.ok) call.resolve(frame.result);
        else call.reject(new Error(frame.error && frame.error.message ? frame.error.message : "Misty refused."));
      };
      request("hello", { sdk: "shim", protocol: 1 }).then(function () { resolve(true); }, function () { resolve(false); });
    });
  });

  function request(method, params) {
    return new Promise(function (resolve, reject) {
      var id = nextId++;
      pending.set(id, { resolve: resolve, reject: reject });
      port.postMessage({ t: "req", id: id, method: method, params: params });
    });
  }

  var connected = false;
  ready.then(function (ok) { connected = ok; });

  var originalInputClick = HTMLInputElement.prototype.click;
  HTMLInputElement.prototype.click = function () {
    var input = this;
    if (input.type !== "file" || !connected) return originalInputClick.apply(input, arguments);
    var accept = (input.accept || "").split(",").map(function (kind) { return kind.trim(); }).filter(Boolean);
    request("files.pick", { accept: accept, multiple: input.multiple })
      .then(function (refs) {
        if (!refs || refs.length === 0) {
          input.dispatchEvent(new Event("cancel", { bubbles: true }));
          return null;
        }
        return Promise.all(
          refs.map(function (ref) {
            return request("files.download", { file_id: ref.id }).then(function (got) {
              return new File([got.data], got.file.name, { type: got.file.mime });
            });
          }),
        );
      })
      .then(function (files) {
        if (!files) return;
        var transfer = new DataTransfer();
        files.forEach(function (file) { transfer.items.add(file); });
        input.files = transfer.files;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      })
      .catch(function () {
        input.dispatchEvent(new Event("cancel", { bubbles: true }));
      });
  };

  var originalAnchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    var link = this;
    var saves = connected && link.hasAttribute("download") && /^(blob|data):/.test(link.href);
    if (!saves) return originalAnchorClick.apply(link, arguments);
    var name = link.getAttribute("download") || "download";
    fetch(link.href)
      .then(function (response) { return response.blob(); })
      .then(function (blob) {
        return blob.arrayBuffer().then(function (data) {
          return request("files.save", { name: name, mime: blob.type || "application/octet-stream", data: data });
        });
      })
      .catch(function () {
        originalAnchorClick.call(link);
      });
  };
})();
