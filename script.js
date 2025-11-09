// === CONFIG ===
const SCRIPT_BASE = "https://script.google.com/macros/s/AKfycbymbBFdMtqLzCEWgHV89tkFsFrv_QJOpVOpNxGcQljNK_4C9OeI3W6lP7r_g1mFGWx2Pw/exec";
let TOKEN = null; // will be set by the consent modal

// Optional testing: allow ?scenario=...&llm=...
const params = new URLSearchParams(location.search);
const forcedScenario = params.get("scenario");
const forcedLLM = params.get("llm");

// Scenario/LLM UI removed; we'll log those values instead of writing to the DOM.
const pairsHost = document.getElementById("pairsHost");
const statusEl = document.getElementById("status");
const submitBtn = document.getElementById("submitBtn");

// Ensure the submit button starts disabled until a manifest is loaded and
// all questions are answered. This prevents submitting when there are no questions.
if (submitBtn) submitBtn.disabled = true;

let isSubmitting = false;
let hasSubmitted = false; // once true, prevent further submissions

// participantId will be a GUID generated on page load (no UI). Set in boot.
let participantId = null;

let manifest = null;

function setStatus(msg, cls = "") {
	statusEl.className = cls;
	statusEl.textContent = msg;
}

// Generate a GUID for participantId. Use crypto.randomUUID when available.
function makeGuid() {
	if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
	// fallback to a reasonably unique id
	const s4 = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
	return `${s4()}${s4()}-${s4()}-${s4()}-${s4()}-${s4()}${s4()}${s4()}`;
}

// Extract the first bracketed mode from a name, including brackets, or null if none.
function extractMode(name) {
	if (!name) return null;
	const m = name.match(/\[[^\]]*\]/);
	return m ? m[0] : null;
}

// Extract the inner content of the first square-bracket group, e.g. "[abc]_..." -> "abc"
function extractFirstBracketContent(s) {
    if (!s) return null;
    const m = s.match(/\[([^\]]+)\]/);
    return m ? m[1] : null;
}

function manifestUrl() {
	const u = new URL(SCRIPT_BASE);
	if (TOKEN) u.searchParams.set("token", TOKEN);
	if (forcedScenario) u.searchParams.set("scenario", forcedScenario);
	if (forcedLLM) u.searchParams.set("llm", forcedLLM);
	return u.toString();
}

async function loadManifest() {
	setStatus("Loading form (this can take several seconds)…");
	const res = await fetch(manifestUrl());
	const j = await res.json();
	if (!j.ok) throw new Error(j.error || "manifest error");
	return j;
}


function renderPairs(pairs) {
  const toDataUrl = (mime, b64) => `data:${mime};base64,${b64}`;

  pairsHost.innerHTML = "";
  pairs.forEach((p, idx) => {
    const qid = "q" + (idx + 1);
    const card = document.createElement("div");
    card.className = "card";

	const head = document.createElement("div");
	// Do not render the pair id in the UI; log it for debugging instead.
	head.innerHTML = `<strong>Question ${idx + 1}</strong>`;
	card.appendChild(head);
    const desc = document.createElement("div");
    desc.innerHTML = `<em>Please select the park design that best balances aesthetic quality and passive surveillance.</em>`;
	card.appendChild(desc);

	// Log pair id to console (developer-visible only)
	console.log(`pair ${qid} id=`, p.id);

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

	// Attach change listeners to inputs so we can enable the submit button when all answered
	// (inputs were added via innerHTML above)
	const radios = card.querySelectorAll(`input[name="${qid}"]`);
	radios.forEach(r => r.addEventListener('change', () => updateSubmitState()));

	// (Removed the optional 'Can't decide' choice per requirement.)

	// Store names and pair id for submit; keep actual srcs in JS properties only
	card.dataset.leftName = p.leftName || "";
	card.dataset.rightName = p.rightName || "";
	card.dataset.pid = p.id; // pair folder name
	// keep srcs on the element (not in dataset) for rendering but avoid sending base64 in POST
	card._leftSrc = leftSrc;
	card._rightSrc = rightSrc;

    pairsHost.appendChild(card);
  });

	// initial update of submit button state
	updateSubmitState();
}


function allAnswered() {
	const cards = Array.from(pairsHost.querySelectorAll('.card'));
	if (cards.length === 0) return false;
	for (let i = 0; i < cards.length; i++) {
		const qid = 'q' + (i + 1);
		const sel = document.querySelector(`input[name="${qid}"]:checked`);
		if (!sel) return false;
	}
	return true;
}

// Ensure required demographics are selected
function demographicsAnswered() {
    const ageSel = document.querySelector('input[name="ageRange"]:checked');
    const expSel = document.querySelector('input[name="experienceYears"]:checked');
    return !!(ageSel && expSel);
}

function updateSubmitState() {
	if (!submitBtn) return;
	if (hasSubmitted || isSubmitting) {
		submitBtn.disabled = true;
		return;
	}
	// require both that all question pairs are answered and that demographics are provided
	submitBtn.disabled = !(allAnswered() && demographicsAnswered());
}

// reload button management
function createReloadButton() {
	// don't create twice
	if (document.getElementById('reloadBtn')) return;
	const btn = document.createElement('button');
	btn.id = 'reloadBtn';
	btn.textContent = 'Load another set';
	btn.style.marginLeft = '12px';
	btn.addEventListener('click', async () => {
		// remove the reload button immediately so it disappears as soon as it's pressed
		removeReloadButton();
		try {
			// clear existing UI and state
			pairsHost.innerHTML = '';
			hasSubmitted = false;
			isSubmitting = false;
			updateSubmitState();
			setStatus('Loading next set…', 'muted');
			// fetch and render new manifest
			manifest = await loadManifest();
			console.log('manifest.scenarioId=', manifest.scenarioId);
			console.log('manifest.llmId=', manifest.llmId);
			renderPairs(manifest.pairs || []);
			setStatus('Loaded.', 'muted');
		} catch (e) {
			console.error(e);
			setStatus(e.message || 'Could not load next set.', 'err');
		}
	});

	// place after status element
	if (statusEl && statusEl.parentNode) {
		statusEl.parentNode.appendChild(btn);
	}
}

function removeReloadButton() {
	const b = document.getElementById('reloadBtn');
	if (b && b.parentNode) b.parentNode.removeChild(b);
}


function collectSelections() {
	const cards = Array.from(pairsHost.querySelectorAll(".card"));
	const selections = [];
	for (let i = 0; i < cards.length; i++) {
		const qid = "q" + (i + 1);
		const sel = document.querySelector(`input[name="${qid}"]:checked`);
		if (!sel) throw new Error("Please answer all questions.");
		const choice = sel.value; // 'A' | 'B' | 'U'
		const leftName = cards[i].dataset.leftName || null;
		const rightName = cards[i].dataset.rightName || null;
		const chosenName = choice === "A" ? leftName : (choice === "B" ? rightName : null);
		const rejectedName = choice === "A" ? rightName : (choice === "B" ? leftName : null);
		const chosenMode = chosenName ? extractMode(chosenName) : null;
		const rejectedMode = rejectedName ? extractMode(rejectedName) : null;
		selections.push({
			qid,
			pairId: cards[i].dataset.pid,
			choice,
			leftName,
			rightName,
			chosenName,
			rejectedName,
			chosenMode,
			rejectedMode,
		});
	}
	return selections;
}

async function submit() {
	// Prevent double submission
	if (isSubmitting || hasSubmitted) return;
	try {
		isSubmitting = true;
		updateSubmitState();
		setStatus("Submitting…");
		// disable the button immediately
		if (submitBtn) submitBtn.disabled = true;

		// final validation: ensure demographics present
		if (!demographicsAnswered()) {
			setStatus('Please complete the demographics section before submitting.', 'err');
			isSubmitting = false;
			updateSubmitState();
			return;
		}

		const selections = collectSelections();
		// participantId was generated on page load (no UI)
		const participantIdLocal = participantId || makeGuid();
		const ts = Date.now();

		const layoutHash = extractFirstBracketContent(manifest && manifest.scenarioId);

		// collect optional demographics (may be null)
		const ageSel = document.querySelector('input[name="ageRange"]:checked');
		const expSel = document.querySelector('input[name="experienceYears"]:checked');
		const demographics = {
			ageRange: ageSel ? ageSel.value : null,
			experienceYears: expSel ? expSel.value : null
		};

		const body = {
			token: TOKEN,
			participantId: participantIdLocal,
			scenarioId: manifest.scenarioId,
			layoutHash: layoutHash,
			llmId: manifest.llmId,
			demographics,
			selections,
			clientMeta: {
				ts: ts,
				ua: navigator.userAgent,
				page: location.href
			}
		};

		const res = await fetch(SCRIPT_BASE + "?token=" + encodeURIComponent(TOKEN), {
			method: "POST",
			// headers: { "Content-Type": "application/json" },
			headers: { "Content-Type": "text/plain;charset=utf-8" },
			// pretty-print the JSON so it's human readable (includes newlines)
			body: JSON.stringify(body, null, 2)
		});
	const j = await res.json();
	if (!j.ok) throw new Error(j.error || "submit failed");
	setStatus("Saved. Thank you.", "ok");
	hasSubmitted = true; // permanently mark as submitted
	updateSubmitState();
	// show a reload button so the user can load another set (clears old data)
	createReloadButton();
	} catch (e) {
		console.error(e);
		setStatus(e.message || "Error", "err");
		// keep the button disabled to avoid multiple submits (per requirement)
		hasSubmitted = true;
		updateSubmitState();
	} finally {
		isSubmitting = false;
	}
}

if (submitBtn) submitBtn.addEventListener("click", submit);

// Attach listeners to demographics radios so submit state updates when they change
function attachDemographicsListeners(){
	const inputs = document.querySelectorAll('input[name="ageRange"], input[name="experienceYears"]');
	inputs.forEach(i => i.addEventListener('change', () => updateSubmitState()));
}

// Attach now — demographics card is in the DOM statically
attachDemographicsListeners();

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
		// generate participantId as a GUID on page load
		participantId = makeGuid();
		manifest = await loadManifest();
		// log scenario and llm to console (UI removed)
		console.log('manifest.scenarioId=', manifest.scenarioId);
		console.log('manifest.llmId=', manifest.llmId);
		renderPairs(manifest.pairs || []);
		setStatus("Loaded.", "muted");
	} catch (e) {
		console.error(e);
		setStatus(e.message || "Could not load form.", "err");
	}
})();
