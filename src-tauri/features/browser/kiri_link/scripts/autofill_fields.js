// What a form field is asking for, and how to write a saved value into it. Works on plain
// descriptions of fields rather than the page, so `autofill_fields.test.ts` can load it as it is.
const autofillFields = (() => {
  const AUTOCOMPLETE = {
    name: 'name',
    'given-name': 'given-name',
    'family-name': 'family-name',
    organization: 'organization',
    'street-address': 'street',
    'address-line1': 'line1',
    'address-line2': 'line2',
    'address-level2': 'city',
    'address-level1': 'region',
    'postal-code': 'postal-code',
    country: 'country',
    'country-name': 'country',
    tel: 'tel',
    'tel-national': 'tel',
    email: 'email',
    'cc-name': 'cc-name',
    'cc-number': 'cc-number',
    'cc-exp': 'cc-exp',
    'cc-exp-month': 'cc-exp-month',
    'cc-exp-year': 'cc-exp-year',
  };
  // Fields that hold something else, whatever else their names say.
  const NEVER =
    /pass(word|code|wd)|\bpwd\b|\bssn\b|social security|tax id|\bein\b|passport|licen[cs]e|captcha|coupon|promo|voucher|gift|discount|search|one.?time|\botp\b|\b2fa\b|username|user name|\blogin\b|nick.?name|display name|screen name|national id|routing|\biban\b|account number|cvv|cvc|\bcsc\b|security code|card code|\bcid\b/;
  // In the order they're tried: card words come first, so "name on card" isn't a plain name.
  const WORDS = [
    ['cc-number', /card.?(number|no\b|num\b)|cardnumber|\bcc.?(number|num)\b|\bpan\b|credit.?card|debit.?card/],
    ['cc-name', /name.?on.?(the.?)?card|card.?holder|cardholder|(card|cc).?name|holder.?name/],
    // One field asking for both, `MM / YY`, before the words that mean only one of them.
    ['cc-exp', /\bmm\b.{0,3}\byy/],
    ['cc-exp-month', /(exp|expiry|expiration|card|cc).*(month|\bmm\b)/],
    ['cc-exp-year', /(exp|expiry|expiration|card|cc).*(year|\byy(yy)?\b)/],
    ['cc-exp', /\bexp\b|expiry|expiration|valid.?(thru|through|until)|\bmm.?\/?.?yy/],
    ['email', /e.?mail/],
    ['tel', /phone|mobile|\btel\b|telephone|cell.?number/],
    ['organization', /company|organi[sz]ation|business.?name/],
    ['given-name', /first.?name|given.?name|\bfname\b|forename/],
    ['family-name', /last.?name|family.?name|surname|\blname\b/],
    ['line2', /(address|addr|street).?(line)?.?2|apartment|\bapt\b|\bsuite\b|\bunit\b|\bfloor\b/],
    ['line1', /(address|addr|street).?(line)?.?1/],
    ['postal-code', /\bzip\b|zip.?code|post.?code|postal/],
    ['city', /\bcity\b|\btown\b|locality|suburb/],
    ['region', /\bstate\b|province|\bregion\b|\bcounty\b/],
    ['country', /\bcountry\b/],
    ['street', /street|\baddress\b|\baddr\b/],
    ['name', /full.?name|your.?name|recipient|\bname\b/],
  ];
  const TEXT_TYPES = /^(text|email|tel|number|)$/;

  const words = (text) =>
    String(text || '')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_\-.[\]]+/g, ' ')
      .toLowerCase();

  /** The field's type, or null when it's not one Misty fills. `meta` describes the element. */
  const classifyField = (meta) => {
    const tag = String(meta.tag || 'input').toLowerCase();
    if (tag === 'input' && !TEXT_TYPES.test(String(meta.type || '').toLowerCase())) return null;
    const tokens = String(meta.autocomplete || '').toLowerCase().trim().split(/\s+/);
    const declared = tokens[tokens.length - 1];
    if (/^(one-time-code|new-password|current-password|username|cc-csc)$/.test(declared)) return null;
    if (AUTOCOMPLETE[declared]) return AUTOCOMPLETE[declared];
    const text = words([meta.name, meta.id, meta.label, meta.placeholder, meta.ariaLabel].join(' '));
    if (NEVER.test(text)) return null;
    for (const [type, pattern] of WORDS) if (pattern.test(text)) return type;
    return null;
  };

  /** Autocomplete's `shipping`, `billing` and `section-*` say which of a form's addresses it is. */
  const sectionOf = (autocomplete) =>
    String(autocomplete || '')
      .toLowerCase()
      .split(/\s+/)
      .filter((token) => token === 'shipping' || token === 'billing' || token.startsWith('section-'))
      .join(' ');

  const isCardType = (type) => String(type).startsWith('cc-');
  const kindOf = (type) => (isCardType(type) ? 'card' : 'address');

  /**
   * Whether these field types really are a form for that kind. A newsletter's email or a contact
   * form's name and email isn't an address, and a lone expiry field isn't a card.
   */
  const formIsFor = (kind, types) => {
    const has = (type) => types.includes(type);
    if (kind === 'card') return has('cc-number');
    const street = has('street') || has('line1');
    const place = has('city') || has('postal-code') || has('region');
    return street ? place || types.length >= 3 : false;
  };

  /**
   * Which fields to fill: each type once, the first at or after the field the person is in, in
   * that field's section. So a form with shipping and billing fills only the one they're in.
   * `fields` is in document order; returns their indexes.
   */
  const planFill = (fields, focusIndex) => {
    const focus = fields[focusIndex];
    if (!focus) return [];
    const kind = kindOf(focus.type);
    const taken = new Map();
    const order = fields.map((_, index) => index);
    const fromFocus = [...order.slice(focusIndex), ...order.slice(0, focusIndex)];
    for (const index of fromFocus) {
      const field = fields[index];
      if (kindOf(field.type) !== kind || field.section !== focus.section) continue;
      if (!taken.has(field.type)) taken.set(field.type, index);
    }
    return [...taken.values()].sort((left, right) => left - right);
  };

  const hintOf = (meta) => words([meta.placeholder, meta.label, meta.name].join(' '));

  const nameParts = (name) => {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length < 2) return [parts[0] || '', ''];
    return [parts.slice(0, -1).join(' '), parts[parts.length - 1]];
  };

  const expiry = (values, meta) => {
    const month = String(values.expMonth).padStart(2, '0');
    const year = String(values.expYear);
    const hint = hintOf(meta);
    const length = Number(meta.maxLength) || 0;
    if (/yyyy|aaaa/.test(hint) || length >= 7) return month + '/' + year;
    if (length === 4) return month + year.slice(-2);
    return month + (/mm\s*-\s*yy/.test(String(meta.placeholder).toLowerCase()) ? '-' : '/') + year.slice(-2);
  };

  /** The text for one field from what Misty sent. Empty means leave the field alone. */
  const valueFor = (type, values, meta) => {
    const lines = String(values.street || '').split('\n');
    switch (type) {
      case 'name': return values.name;
      case 'given-name': return nameParts(values.name)[0];
      case 'family-name': return nameParts(values.name)[1];
      case 'organization': return values.organization;
      case 'street': return lines.join(String(meta.tag).toLowerCase() === 'textarea' ? '\n' : ', ');
      case 'line1': return lines[0];
      case 'line2': return lines.slice(1).join(', ');
      case 'city': return values.city;
      case 'region': return values.region;
      case 'postal-code': return values.postalCode;
      case 'country': return values.country;
      case 'tel': return values.phone;
      case 'email': return values.email;
      case 'cc-name': return values.holder;
      case 'cc-number': return values.number;
      case 'cc-exp': return expiry(values, meta);
      case 'cc-exp-month': return String(values.expMonth).padStart(2, '0');
      case 'cc-exp-year': {
        const length = Number(meta.maxLength) || 0;
        const short = length === 2 || (/\byy\b/.test(hintOf(meta)) && !/yyyy/.test(hintOf(meta)));
        return short ? String(values.expYear).slice(-2) : String(values.expYear);
      }
      default: return '';
    }
  };

  const US_STATES = 'al alabama ak alaska az arizona ar arkansas ca california co colorado ct connecticut de delaware dc districtofcolumbia fl florida ga georgia hi hawaii id idaho il illinois in indiana ia iowa ks kansas ky kentucky la louisiana me maine md maryland ma massachusetts mi michigan mn minnesota ms mississippi mo missouri mt montana ne nebraska nv nevada nh newhampshire nj newjersey nm newmexico ny newyork nc northcarolina nd northdakota oh ohio ok oklahoma or oregon pa pennsylvania ri rhodeisland sc southcarolina sd southdakota tn tennessee tx texas ut utah vt vermont va virginia wa washington wv westvirginia wi wisconsin wy wyoming'.split(' ');
  const COUNTRIES = [
    ['us', 'usa', 'unitedstates', 'unitedstatesofamerica'],
    ['gb', 'uk', 'unitedkingdom', 'greatbritain'],
    ['ca', 'can', 'canada'],
    ['au', 'aus', 'australia'],
    ['de', 'deu', 'germany'],
    ['fr', 'fra', 'france'],
  ];
  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const plain = (text) => String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

  const sameMeaning = (type, left, right) => {
    if (left === right) return true;
    if (type === 'region') {
      const index = US_STATES.indexOf(left);
      const other = US_STATES.indexOf(right);
      return index >= 0 && other >= 0 && Math.floor(index / 2) === Math.floor(other / 2);
    }
    if (type === 'country') return COUNTRIES.some((names) => names.includes(left) && names.includes(right));
    return false;
  };

  const monthNumber = (text) => {
    const digits = String(text || '').match(/\d{1,2}/);
    if (digits && Number(digits[0]) >= 1 && Number(digits[0]) <= 12) return Number(digits[0]);
    const name = plain(text);
    if (name.length < 3) return 0;
    return MONTHS.findIndex((month) => month.startsWith(name.slice(0, 3))) + 1;
  };

  /** The index of the option that means this value, or -1. `options` are {value, text}. */
  const matchOption = (type, value, options) => {
    if (type === 'cc-exp-month') {
      const wanted = Number(value);
      return options.findIndex((o) => monthNumber(o.value) === wanted || monthNumber(o.text) === wanted);
    }
    if (type === 'cc-exp-year') {
      const wanted = String(value).slice(-2);
      return options.findIndex((o) => /^\d{2,4}$/.test(String(o.value).trim()) && String(o.value).trim().slice(-2) === wanted);
    }
    const wanted = plain(value);
    if (!wanted) return -1;
    const exact = options.findIndex((o) =>
      sameMeaning(type, plain(o.value), wanted) || sameMeaning(type, plain(o.text), wanted));
    if (exact >= 0 || wanted.length < 4) return exact;
    return options.findIndex((o) => plain(o.text).startsWith(wanted));
  };

  /** Month and year from one expiry field: `12/31`, `12 / 2031`, `1231`. */
  const parseExpiry = (text) => {
    const match = String(text || '').trim().match(/^(\d{1,2})\s*[/\-\s]?\s*(\d{2}|\d{4})$/);
    return match ? { month: Number(match[1]), year: Number(match[2]) } : { month: 0, year: 0 };
  };

  /** What a submitted form says, from its [type, text] pairs. */
  const readForm = (entries) => {
    const first = (type) => {
      const found = entries.find(([candidate, text]) => candidate === type && String(text).trim());
      return found ? String(found[1]).trim() : '';
    };
    const form = {};
    const types = entries.map(([type]) => type);
    if (formIsFor('address', types)) {
      const full = first('name') || [first('given-name'), first('family-name')].filter(Boolean).join(' ');
      form.address = {
        name: full,
        organization: first('organization'),
        street: first('street') || [first('line1'), first('line2')].filter(Boolean).join('\n'),
        city: first('city'),
        region: first('region'),
        postalCode: first('postal-code'),
        country: first('country'),
        phone: first('tel'),
        email: first('email'),
      };
    }
    if (first('cc-number')) {
      const combined = parseExpiry(first('cc-exp'));
      form.card = {
        number: first('cc-number'),
        holder: first('cc-name'),
        expMonth: combined.month || monthNumber(first('cc-exp-month')),
        expYear: combined.year || Number(first('cc-exp-year')) || 0,
      };
    }
    return form;
  };

  return Object.freeze({
    classifyField,
    sectionOf,
    kindOf,
    formIsFor,
    planFill,
    valueFor,
    matchOption,
    readForm,
  });
})();
