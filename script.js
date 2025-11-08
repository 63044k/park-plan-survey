// === CONFIG ===
const SCRIPT_BASE = "https://script.google.com/macros/s/AKfycbymbBFdMtqLzCEWgHV89tkFsFrv_QJOpVOpNxGcQljNK_4C9OeI3W6lP7r_g1mFGWx2Pw/exec";
let TOKEN = null; // will be set by the consent modal

// Optional testing: allow ?scenario=...&llm=...
const params = new URLSearchParams(location.search);
const forcedScenario = params.get("scenario");
const forcedLLM = params.get("llm");

const scenarioEl = document.getElementById("scenario");
const llmEl = document.getElementById("llm");
const pairsHost = document.getElementById("pairsHost");
const statusEl = document.getElementById("status");
const pidEl = document.getElementById("pid");

let manifest = null;

function setStatus(msg, cls = "") {
	statusEl.className = cls;
	statusEl.textContent = msg;
}

function manifestUrl() {
	const u = new URL(SCRIPT_BASE);
	if (TOKEN) u.searchParams.set("token", TOKEN);
	if (forcedScenario) u.searchParams.set("scenario", forcedScenario);
	if (forcedLLM) u.searchParams.set("llm", forcedLLM);
	return u.toString();
}

async function loadManifest() {
	setStatus("Loading form…");
	const res = await fetch(manifestUrl());
	const j = await res.json();
	if (!j.ok) throw new Error(j.error || "manifest error");
	return j;
}

function renderPairsX(pairs) {
	pairsHost.innerHTML = "";
	pairs.forEach((p, idx) => {
		const qid = "q" + (idx + 1); // simple sequential ids for the client
		const card = document.createElement("div");
		card.className = "card";

		const head = document.createElement("div");
		head.innerHTML = `<strong>Question ${idx + 1}</strong> <span class="muted">${p.id}</span>`;
		card.appendChild(head);

		const grid = document.createElement("div");
		grid.className = "grid";

		const leftWrap = document.createElement("div");
		leftWrap.innerHTML = `
			<img src="${p.left}" alt="${qid}-A">
			<label class="block"><input type="radio" name="${qid}" value="A"> Choose A</label>
		`;

		const rightWrap = document.createElement("div");
		rightWrap.innerHTML = `
			<img src="${p.right}" alt="${qid}-B">
			<label class="block"><input type="radio" name="${qid}" value="B"> Choose B</label>
		`;

		grid.appendChild(leftWrap);
		grid.appendChild(rightWrap);
		card.appendChild(grid);

		// optional undecided
		const undec = document.createElement("label");
		undec.className = "block muted";
		undec.innerHTML = `<input type="radio" name="${qid}" value="U"> Can't decide`;
		card.appendChild(undec);

		// store original URLs as data attributes for later POST
		card.dataset.left = p.left;
		card.dataset.right = p.right;
		card.dataset.pid = p.id; // pair folder name

		pairsHost.appendChild(card);
	});
}

function renderPairs(pairs) {
  const toDataUrl = (mime, b64) => `data:${mime};base64,${b64}`;

  pairsHost.innerHTML = "";
  pairs.forEach((p, idx) => {
    const qid = "q" + (idx + 1);
    const card = document.createElement("div");
    card.className = "card";

    const head = document.createElement("div");
    head.innerHTML = `<strong>Question ${idx + 1}</strong> <span class="muted">${p.id}</span>`;
    card.appendChild(head);

    const grid = document.createElement("div");
    grid.className = "grid";

    // Build sources:
    const leftSrc  = p.leftB64  ? toDataUrl(p.leftMime,  p.leftB64)  : (p.left  || "");
    const rightSrc = p.rightB64 ? toDataUrl(p.rightMime, p.rightB64) : (p.right || "");

    const leftWrap = document.createElement("div");
    leftWrap.innerHTML = `
      <img src="${leftSrc}" alt="${qid}-A">
      <label class="block"><input type="radio" name="${qid}" value="A"> Choose A</label>
    `;

    const rightWrap = document.createElement("div");
    rightWrap.innerHTML = `
      <img src="${rightSrc}" alt="${qid}-B">
      <label class="block"><input type="radio" name="${qid}" value="B"> Choose B</label>
    `;

    grid.appendChild(leftWrap);
    grid.appendChild(rightWrap);
    card.appendChild(grid);

    // Optional undecided
    const undec = document.createElement("label");
    undec.className = "block muted";
    undec.innerHTML = `<input type="radio" name="${qid}" value="U"> Can't decide`;
    card.appendChild(undec);

    // Store sources for submit (note: these are data URLs now)
    card.dataset.left = leftSrc;
    card.dataset.right = rightSrc;
    card.dataset.pid = p.id; // pair folder name

    pairsHost.appendChild(card);
  });
}


function collectSelections() {
	const cards = Array.from(pairsHost.querySelectorAll(".card"));
	const selections = [];
	for (let i = 0; i < cards.length; i++) {
		const qid = "q" + (i + 1);
		const sel = document.querySelector(`input[name="${qid}"]:checked`);
		if (!sel) throw new Error("Please answer all questions.");
		const choice = sel.value; // 'A' | 'B' | 'U'
		const left = cards[i].dataset.left;
		const right = cards[i].dataset.right;
		selections.push({
			qid,
			pairId: cards[i].dataset.pid,
			choice,
			chosenImage: choice === "A" ? left : (choice === "B" ? right : null),
			left,
			right
		});
	}
	return selections;
}

async function submit() {
	try {
		setStatus("Submitting…");
		const selections = collectSelections();
		const participantId = (pidEl.value || "").trim();

		const body = {
			token: TOKEN,
			scenarioId: manifest.scenarioId,
			llmId: manifest.llmId,
			participantId,
			selections,
			clientMeta: {
				ts: Date.now(),
				ua: navigator.userAgent,
				page: location.href
			}
		};

		const res = await fetch(SCRIPT_BASE + "?token=" + encodeURIComponent(TOKEN), {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body)
		});
		const j = await res.json();
		if (!j.ok) throw new Error(j.error || "submit failed");
		setStatus("Saved. Thank you.", "ok");
	} catch (e) {
		console.error(e);
		setStatus(e.message || "Error", "err");
	}
}

document.getElementById("submitBtn").addEventListener("click", submit);

// boot
// show consent modal and require token before loading manifest
async function requireConsentAndToken() {
	// if TOKEN already present (saved) we're good
	if (TOKEN) return TOKEN;

	const modal = document.getElementById('consentModal');
	const secretInput = document.getElementById('secretInput');
	const consentCheckbox = document.getElementById('consentCheckbox');
	const continueBtn = document.getElementById('consentContinueBtn');
	const status = document.getElementById('consentStatus');

	function updateContinueState() {
		continueBtn.disabled = !consentCheckbox.checked || !(secretInput.value && secretInput.value.trim());
	}

	secretInput.addEventListener('input', updateContinueState);
	consentCheckbox.addEventListener('change', updateContinueState);

	modal.style.display = 'flex';
	secretInput.focus();

	return new Promise((resolve) => {
		continueBtn.addEventListener('click', () => {
			const tokenVal = (secretInput.value || '').trim();
			if (!consentCheckbox.checked) {
				status.textContent = 'You must consent to continue.';
				return;
			}
			if (!tokenVal) {
				status.textContent = 'Please enter the secret token.';
				return;
			}
					TOKEN = tokenVal;
			modal.style.display = 'none';
			resolve(TOKEN);
		}, { once: true });
	});
}

(async () => {
	try {
		await requireConsentAndToken();
		manifest = await loadManifest();
		scenarioEl.textContent = manifest.scenarioId;
		llmEl.textContent = manifest.llmId;
		renderPairs(manifest.pairs || []);
		setStatus("Loaded.", "muted");
	} catch (e) {
		console.error(e);
		setStatus(e.message || "Could not load form.", "err");
	}
})();
