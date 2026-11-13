// Misty agent page runtime: what acting on a control would do, for the stop before paying, sending,
// deleting or posting. Names are only one signal, since a site can be in any language or call its
// button anything: a form's address and its payment fields count too. Still not protected: a control
// with no name in a language listed here and nothing else to go on, and whatever runs inside a
// cross-origin frame that doesn't name a payment provider.
((P) => {
  const clip = P.clip;
  // \b knows only ASCII, and lookbehind isn't in every WebKit Misty runs on.
  const words = (list) => new RegExp(`(^|[^\\p{L}\\p{N}])(?:${list})($|[^\\p{L}\\p{N}])`, "iu");
  // Scripts with no spaces between words are matched anywhere in the name.
  const inside = (list) => new RegExp(list, "u");

  const kindWords = [
    ["payment", [
      words("pay|pay now|buy|buy now|purchase|place (?:your )?order|order now|submit order|complete (?:your )?(?:order|purchase|payment)|confirm (?:and pay|payment|purchase|order)|checkout|check out|donate|transfer|withdraw|send money|subscribe|start (?:my )?(?:subscription|membership|trial)"
        + "|pagar|comprar|finalizar (?:compra|pedido)|realizar pedido|confirmar (?:compra|pedido|pago)|payer|acheter|commander|passer (?:la )?commande|valider (?:la )?commande|bezahlen|kaufen|jetzt kaufen|zur kasse|bestellen|kostenpflichtig bestellen|paga|acquista|ordina|betalen|kopen|bestellen|afrekenen|оплатить|купить|заказать|оформить заказ"),
      inside("購入|支払|注文|决済|決済|购买|購買|支付|付款|下单|下單|结账|結帳|구매|결제|주문"),
    ]],
    ["delete", [
      words("delete|remove|erase|destroy|discard|empty trash|permanently|cancel (?:my )?(?:subscription|membership|account|order)|close (?:my )?account"
        + "|eliminar|borrar|supprimer|effacer|löschen|entfernen|excluir|apagar|elimina|cancella|verwijderen|удалить"),
      inside("削除|删除|刪除|삭제"),
    ]],
    ["publish", [
      words("publish|make public|go live|post|tweet|share publicly|share"
        + "|publicar|publier|veröffentlichen|posten|pubblica|publiceren|plaatsen|опубликовать"),
      inside("公開|投稿|发布|發布|发表|發表|게시"),
    ]],
    ["send", [
      words("send|reply|reply all|forward|comment|message"
        + "|enviar|responder|comentar|envoyer|répondre|commenter|senden|absenden|antworten|kommentieren|invia|rispondi|commenta|verzenden|versturen|отправить|ответить"),
      inside("送信|返信|发送|發送|傳送|回复|回覆|보내기|전송|답장"),
    ]],
  ];
  const kindOfName = (name) => kindWords.find(([, patterns]) => patterns.some((pattern) => pattern.test(name || "")))?.[0] ?? "";

  // Words that make a click send, buy, share or destroy something, past the four kinds. A match asks
  // the person first unless the model said this step is part of the task.
  const consequentialWords = /\b(send|post|publish|tweet|pay|buy|purchase|place order|order now|submit order|checkout|check out|donate|delete|remove|erase|destroy|discard|share|invite|transfer|withdraw|unsubscribe|cancel (my )?(subscription|membership|account|order)|make public|grant access|give access|submit|turn in|hand in)\b/i;
  const consequential = (name) => consequentialWords.test(name || "") || !!kindOfName(name);

  const paymentAddress = /(^|[/._-])(checkout|payments?|pay|billing|purchase|orders?)([/._-]|$)/i;
  const paymentFields = '[autocomplete*="cc-"],input[name*="card" i][name*="number" i],input[name*="cardnumber" i],input[id*="cardnumber" i],input[name*="cvv" i],input[name*="cvc" i]';
  const paymentFrames = 'iframe[src*="stripe" i],iframe[src*="braintree" i],iframe[src*="adyen" i],iframe[src*="paypal" i],iframe[src*="checkout" i],iframe[src*="payment" i],iframe[title*="payment" i],iframe[title*="card" i],iframe[name*="card" i]';
  const paymentFrame = (el) => el?.tagName === "IFRAME" && el.matches(paymentFrames);
  const addressPath = (form) => {
    const action = form.getAttribute("action") || "";
    try { return new URL(action, location.href).pathname; } catch { return action.split(/[?#]/)[0]; }
  };
  const paymentForm = (form) => !!form && (!!form.querySelector(paymentFields) || !!form.querySelector(paymentFrames) || (!!form.getAttribute("action") && paymentAddress.test(addressPath(form))));

  const submitButton = 'button:not([type]),button[type=submit],input[type=submit],input[type=image]';
  const pressable = 'button,a[href],[role=button],[role=link],[role=menuitem],input[type=submit],input[type=button],input[type=image]';

  // A link that only goes to another page ("Buy stamps now" on a shop's front page) opens the
  // product; paying takes a later checkout button, which is still asked about. Delete, send and
  // post stay asked about on links too: some sites do those with a plain link.
  const navigationLink = (el) => {
    const link = el.closest?.("a[href]");
    const href = link?.getAttribute("href") || "";
    return Boolean(link) && !link.hasAttribute("download") && /^https?:/.test(link.href) && !href.startsWith("#") && !(el.form || el.closest?.("form"));
  };
  const linkOnly = (el, name) => navigationLink(el) && kindOfName(name) === "payment";

  const searchWords = words("search|find|filter|buscar|rechercher|suchen|cerca|zoeken|поиск");
  const searchWordsInside = inside("検索|搜索|搜尋|검색");
  const labelOf = (el) => [el.getAttribute?.("aria-label"), el.getAttribute?.("placeholder"), el.getAttribute?.("name"), el.getAttribute?.("data-placeholder"), P.name(el)].filter(Boolean).join(" ");
  const searchField = (el) => {
    const role = el.getAttribute?.("role");
    if (role === "searchbox" || role === "combobox" || el.getAttribute?.("type") === "search" || el.closest?.('[role=search],search')) return true;
    const label = labelOf(el);
    return searchWords.test(label) || searchWordsInside.test(label);
  };
  const composerWords = words("message|reply|comment|write|compose|chat|tweet|post|mensaje|responder|comentario|écrire|message|répondre|commentaire|nachricht|antworten|kommentar|messaggio|rispondi|commento|bericht|сообщение|ответить");
  const composerWordsInside = inside("メッセージ|返信|コメント|消息|訊息|回复|回覆|评论|留言|메시지|답글|댓글");
  /** A send or post button beside this field, which is what makes Enter there send. */
  const besideSendButton = (el) => {
    let around = el.parentElement;
    for (let depth = 0; around && depth < 5; depth++, around = around.parentElement) {
      const buttons = around.querySelectorAll?.('button,[role=button],input[type=submit]') ?? [];
      if (buttons.length > 40) return false;
      for (const button of buttons) {
        const kind = kindOfName(P.name(button));
        if (kind === "send" || kind === "publish") return true;
      }
    }
    return false;
  };
  /**
   * Whether Enter in this field outside a form sends what's in it. Cmd or Ctrl+Enter in anything you
   * can write in does. Plain Enter is a new line in a document editor and a search in a search box, so
   * it counts only where something says this is for writing to someone.
   */
  const composerSends = (el, commit) => {
    if (!el || searchField(el)) return false;
    const multiline = el.isContentEditable || el.closest?.('[contenteditable=""],[contenteditable=true]') || el.tagName === "TEXTAREA" || el.getAttribute?.("role") === "textbox";
    const field = multiline || (el.tagName === "INPUT" && ["text", "", null].includes(el.getAttribute("type")));
    if (!field) return false;
    if (commit && multiline) return true;
    const label = labelOf(el);
    return besideSendButton(el) || (multiline && (composerWords.test(label) || composerWordsInside.test(label)));
  };

  const isEnter = (key) => /^(enter|return|numpadenter)$/i.test(key || "");
  P.isCommitKey = (key) => isEnter(key) || key === "Space" || key === " ";
  P.isCommit = (modifiers) => (modifiers || []).some((item) => /^(meta|control|ctrl|cmd|command)$/i.test(item));

  /** Why acting on el would have consequences for other people or money, or "". */
  P.consequence = (el, action, commit = false) => {
    if (!el) return "";
    const name = P.name(el);
    if (action === "key" && el.matches?.(pressable)) return P.consequence(el, "click");
    if (action !== "key" && linkOnly(el, name)) return "";
    const form = el.form || el.closest?.("form");
    if (action === "key") {
      // Enter in a field submits its form the way its default button would.
      if (!form) return composerSends(el, commit) ? "Pressing Enter sends what's written here." : "";
      const submit = form.querySelector(submitButton);
      if (paymentForm(form)) return "Pressing Enter submits a payment form.";
      if (submit && consequential(P.name(submit))) return `Pressing Enter submits the form with “${clip(P.name(submit), 40)}”.`;
      return "";
    }
    if (consequential(name)) return `“${clip(name, 60)}” may send, buy, share or delete something.`;
    const submits = el.matches?.(submitButton) && form;
    if (submits && paymentForm(form)) return "This submits a payment form.";
    return "";
  };

  // The four kinds that always stop for the person in Misty, whatever the
  // model asked for. Other consequential steps keep the
  // allowConsequential rule.
  /** "payment", "send", "delete", "publish" or "" for acting on el. */
  P.consequenceKind = (el, action, commit = false) => {
    if (!el) return "";
    if (action === "key" && el.matches?.(pressable)) return P.consequenceKind(el, "click");
    const form = el.form || el.closest?.("form");
    if (action === "key") {
      if (!form) return composerSends(el, commit) ? "send" : "";
      if (paymentForm(form)) return "payment";
      const submit = form.querySelector(submitButton);
      return submit ? kindOfName(P.name(submit)) : "";
    }
    if (linkOnly(el, P.name(el))) return "";
    const named = kindOfName(P.name(el));
    if (named) return named;
    const submits = el.matches?.(submitButton) && form;
    return submits && paymentForm(form) ? "payment" : "";
  };

  /** What clicking at this share of the viewport would do, for a click planned from a screenshot. */
  P.consequenceAt = ({ x, y }) => {
    const hit = P.deepHit(document, x * innerWidth, y * innerHeight);
    if (!hit) return { consequence: "", consequenceKind: "", describe: "" };
    if (paymentFrame(hit)) return { consequence: "This is a payment form in a frame.", consequenceKind: "payment", describe: "payment frame" };
    const el = hit.closest?.(pressable + ",label,input,select,textarea") || hit;
    const target = el.tagName === "LABEL" && el.control ? el.control : el;
    return { consequence: P.consequence(target, "click"), consequenceKind: P.consequenceKind(target, "click"), describe: P.describe(target) };
  };

  /** What this key does where the focus is. */
  P.consequenceOfKey = ({ key, modifiers }) => {
    if (!P.isCommitKey(key)) return { consequence: "", consequenceKind: "", describe: "" };
    const el = document.activeElement;
    const commit = P.isCommit(modifiers);
    return { consequence: P.consequence(el, "key", commit), consequenceKind: P.consequenceKind(el, "key", commit), describe: P.describe(el) };
  };

  /** What a question can call a control, without anything a page could use to act. */
  P.describeRef = ({ ref }) => {
    const el = P.state.refs.get(ref)?.el;
    if (!el?.isConnected) return { name: "", password: false };
    return { name: P.describe(el), password: el.getAttribute?.("type") === "password" };
  };
})(globalThis.__mistyAgentPageV1 ??= {});
