// 暗号化した予定データ（data/events.js）を、家族用の合言葉で開く。
// 方式は apps-script/Code.gs の「暗号化」と同じ（PBKDF2-SHA256 → AES-256-CTR + HMAC-SHA256）。
// 合言葉そのものは保存せず、合言葉から作った鍵だけを「この端末で覚える」ときに保存する。
(function () {
  "use strict";

  const FORMAT = "famical-enc-v1";
  const STORAGE_KEY = "famical.key.v1";
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  class WrongKeyError extends Error {}

  function base64UrlToBytes(text) {
    const normal = String(text || "").replace(/-/g, "+").replace(/_/g, "/");
    const padded = normal + "===".slice((normal.length + 3) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  function bytesToBase64Url(bytes) {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 1) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function isSupported() {
    return Boolean(window.crypto && window.crypto.subtle && window.TextEncoder);
  }

  function isEncryptedData(value) {
    return Boolean(value && value.format === FORMAT && value.kdf && value.iv && value.data && value.mac);
  }

  async function deriveMasterKey(password, kdf) {
    const baseKey = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({
      name: "PBKDF2",
      hash: "SHA-256",
      salt: base64UrlToBytes(kdf.salt),
      iterations: kdf.iterations
    }, baseKey, 256);
    return new Uint8Array(bits);
  }

  async function hmacBytes(keyBytes, text) {
    const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(text)));
  }

  async function decryptWithMasterKey(encrypted, masterKey) {
    const encKey = await hmacBytes(masterKey, `${FORMAT}|enc`);
    const macKeyBytes = await hmacBytes(masterKey, `${FORMAT}|mac`);
    const macKey = await crypto.subtle.importKey("raw", macKeyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify(
      "HMAC",
      macKey,
      base64UrlToBytes(encrypted.mac),
      encoder.encode(`${encrypted.iv}.${encrypted.data}`)
    );
    if (!valid) {
      throw new WrongKeyError("合言葉が違います。");
    }
    const aesKey = await crypto.subtle.importKey("raw", encKey, { name: "AES-CTR" }, false, ["decrypt"]);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-CTR", counter: base64UrlToBytes(encrypted.iv), length: 32 },
      aesKey,
      base64UrlToBytes(encrypted.data)
    );
    return JSON.parse(decoder.decode(plain));
  }

  function loadSavedKey() {
    try {
      const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null");
      return saved && saved.key && saved.salt ? saved : null;
    } catch (error) {
      return null;
    }
  }

  function saveKey(kdf, masterKey) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        salt: kdf.salt,
        iterations: kdf.iterations,
        key: bytesToBase64Url(masterKey)
      }));
    } catch (error) {
      // 保存できない端末（プライベートブラウズなど）では、毎回合言葉を入れる。
    }
  }

  function forgetKey() {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      // 何もしない
    }
  }

  function hasSavedKey() {
    return Boolean(loadSavedKey());
  }

  // 保存した鍵で開けるときはそのまま開き、開けないときは合言葉の入力画面を出す。
  async function open(encrypted, options = {}) {
    if (!isEncryptedData(encrypted)) {
      throw new Error("予定データの形式を読めません。ページを読み込み直してください。");
    }
    if (!isSupported()) {
      throw new Error("このブラウザでは予定を開けません。新しいブラウザで開いてください。");
    }

    let message = "";
    const saved = loadSavedKey();
    if (saved) {
      if (saved.salt === encrypted.kdf.salt && saved.iterations === encrypted.kdf.iterations) {
        try {
          return await decryptWithMasterKey(encrypted, base64UrlToBytes(saved.key));
        } catch (error) {
          if (!(error instanceof WrongKeyError)) {
            throw error;
          }
        }
      }
      // 合言葉が変わると鍵の材料（ソルト）も変わるので、入れ直してもらう。
      forgetKey();
      message = "合言葉が変わったようです。新しい合言葉を入れてください。";
    }

    return askPassword(encrypted, message, options);
  }

  function askPassword(encrypted, firstMessage, options) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "lock-screen";

      const form = document.createElement("form");
      form.className = "lock-card";
      form.setAttribute("role", "dialog");
      form.setAttribute("aria-modal", "true");
      form.setAttribute("aria-labelledby", "lockTitle");

      const kicker = document.createElement("p");
      kicker.className = "eyebrow";
      kicker.textContent = options.kicker || "Family Calendar";

      const title = document.createElement("h2");
      title.id = "lockTitle";
      title.textContent = "合言葉を入れてください";

      const message = document.createElement("p");
      message.className = "lock-message";
      message.setAttribute("role", "alert");
      message.textContent = firstMessage || "";
      message.hidden = !firstMessage;

      // パスワード管理機能が「どのサイトの合言葉か」を区別できるよう、名前欄を隠して置く。
      const userField = document.createElement("input");
      userField.type = "text";
      userField.name = "username";
      userField.autocomplete = "username";
      userField.value = "family-calendar";
      userField.hidden = true;

      const input = document.createElement("input");
      input.type = "password";
      input.name = "password";
      input.className = "lock-input";
      input.autocomplete = "current-password";
      input.required = true;
      input.setAttribute("aria-label", "合言葉");

      const rememberLabel = document.createElement("label");
      rememberLabel.className = "lock-remember";
      const remember = document.createElement("input");
      remember.type = "checkbox";
      remember.checked = true;
      rememberLabel.append(remember, document.createTextNode("この端末で覚える"));

      const button = document.createElement("button");
      button.className = "primary-button lock-button";
      button.type = "submit";
      button.textContent = "ひらく";

      form.append(kicker, title, message, userField, input, rememberLabel, button);
      overlay.append(form);
      document.body.append(overlay);
      input.focus();

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const password = input.value;
        if (!password) {
          return;
        }
        button.disabled = true;
        button.textContent = "確認中...";
        message.hidden = true;
        try {
          const masterKey = await deriveMasterKey(password, encrypted.kdf);
          const payload = await decryptWithMasterKey(encrypted, masterKey);
          if (remember.checked) {
            saveKey(encrypted.kdf, masterKey);
          }
          overlay.remove();
          resolve(payload);
        } catch (error) {
          message.textContent = error instanceof WrongKeyError
            ? "合言葉が違います。"
            : `開けませんでした。${error && error.message ? error.message : ""}`;
          message.hidden = false;
          button.disabled = false;
          button.textContent = "ひらく";
          input.select();
        }
      });
    });
  }

  window.FamiCalCrypto = {
    open,
    forgetKey,
    hasSavedKey,
    isEncryptedData,
    // 動作確認用
    _decryptWithMasterKey: decryptWithMasterKey,
    _deriveMasterKey: deriveMasterKey
  };
})();
