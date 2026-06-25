/**
 * social.js — Screenshot sharing, Twitter/Instagram, invite links, Web Share API
 */

import { currentUser, storage } from './firebase-config.js';

// ─── Screenshot capture ───────────────────────────────────────────────────────
export async function captureScreenshot(gameCanvas) {
  return new Promise((resolve) => {
    const overlay = document.createElement('canvas');
    overlay.width  = gameCanvas.width  || gameCanvas.clientWidth;
    overlay.height = gameCanvas.height || gameCanvas.clientHeight;
    const ctx = overlay.getContext('2d');

    // Draw game canvas
    ctx.drawImage(gameCanvas, 0, 0, overlay.width, overlay.height);

    // Watermark
    ctx.save();
    ctx.fillStyle   = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, overlay.height - 52, overlay.width, 52);
    ctx.fillStyle   = '#ff3b3b';
    ctx.font        = 'bold 20px "Rubik","Segoe UI",sans-serif';
    ctx.fillText('DEAD ZONE', 16, overlay.height - 24);
    ctx.fillStyle   = '#e4e0da';
    ctx.font        = '14px "Rubik","Segoe UI",sans-serif';
    ctx.fillText('deadzone.game', overlay.width - 130, overlay.height - 24);
    ctx.restore();

    overlay.toBlob(blob => resolve(blob), 'image/png', 0.92);
  });
}

// ─── Download screenshot locally ──────────────────────────────────────────────
export function downloadScreenshot(blob, score, wave) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href    = url;
  a.download = `deadzone-score${score}-wave${wave}.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ─── Upload to Firebase Storage ───────────────────────────────────────────────
export async function uploadScreenshot(blob, score, wave) {
  const user = currentUser();
  if (!user || !storage) return null;
  try {
    const { ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
    const path    = `screenshots/${user.uid}/score${score}-wave${wave}-${Date.now()}.png`;
    const storRef = ref(storage, path);
    await uploadBytes(storRef, blob, { contentType: 'image/png' });
    return await getDownloadURL(storRef);
  } catch (e) {
    console.warn('[Social] upload failed:', e.message);
    return null;
  }
}

// ─── Twitter / X share ───────────────────────────────────────────────────────
export function shareToTwitter(score, wave, kills) {
  const text = encodeURIComponent(
    `I survived to Wave ${wave} and scored ${score.toLocaleString()} in DEAD ZONE! 🧟 ${kills} zombies eliminated. Can you beat me?\n#DeadZone #ZombieSurvivor #WebGame`
  );
  const url  = encodeURIComponent('https://deadzone.game');
  window.open(`https://twitter.com/intent/tweet?text=${text}&url=${url}`, '_blank', 'width=600,height=400');
}

// ─── Web Share API (mobile-native) ───────────────────────────────────────────
export async function shareViaNative(blob, score, wave, kills) {
  const shareData = {
    title: 'DEAD ZONE — Zombie Survivor',
    text:  `I scored ${score.toLocaleString()} and survived to Wave ${wave} in DEAD ZONE! ${kills} zombies killed. Beat that! 🧟‍♂️`,
    url:   'https://deadzone.game',
  };

  // Try with screenshot image if Web Share API supports files
  if (blob && navigator.canShare) {
    const file = new File([blob], 'deadzone-score.png', { type: 'image/png' });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ ...shareData, files: [file] });
        return true;
      } catch (e) {
        if (e.name !== 'AbortError') console.warn('[Social] file share failed:', e.message);
      }
    }
  }

  // Fallback: share URL only
  if (navigator.share) {
    try {
      await navigator.share(shareData);
      return true;
    } catch (e) {
      if (e.name !== 'AbortError') console.warn('[Social] share failed:', e.message);
    }
  }

  // Last resort: copy to clipboard
  try {
    await navigator.clipboard.writeText(`${shareData.text} ${shareData.url}`);
    return 'copied';
  } catch {
    return false;
  }
}

// ─── Invite link ─────────────────────────────────────────────────────────────
export function getInviteLink(userId = null) {
  const base = 'https://deadzone.game';
  const ref  = userId ? `?ref=${userId.slice(0, 8)}` : '';
  return `${base}${ref}`;
}

// ─── Pre-built share card (DOM element for screenshot overlay) ────────────────
export function buildShareOverlay(score, wave, kills, accuracy) {
  const el       = document.createElement('div');
  el.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:99999',
    'background:rgba(0,0,0,0.85)', 'display:flex',
    'align-items:center', 'justify-content:center',
    'font-family:Rubik,sans-serif', 'cursor:pointer',
  ].join(';');

  el.innerHTML = `
    <div style="background:linear-gradient(135deg,#0d1117,#1a0505);border:1px solid rgba(192,32,42,0.4);
         border-radius:16px;padding:32px 40px;max-width:460px;width:90%;text-align:center;
         box-shadow:0 0 60px rgba(192,32,42,0.2);">
      <div style="font-family:Creepster,cursive;font-size:2.8rem;color:#c0202a;
           text-shadow:0 0 20px rgba(192,32,42,0.6);letter-spacing:0.1em;">
        DEAD ZONE
      </div>
      <div style="font-size:0.75rem;letter-spacing:0.3em;color:#8a9090;
           text-transform:uppercase;margin-bottom:28px;">Zombie Survival</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:28px;">
        ${_statBox('SCORE', score.toLocaleString(), '#ff3b3b')}
        ${_statBox('WAVE',  wave, '#8fd14f')}
        ${_statBox('KILLS', kills, '#f5c518')}
        ${_statBox('ACCURACY', `${accuracy}%`, '#38bdf8')}
      </div>
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
        <button id="dz-share-twitter" style="${_btnStyle('#1da1f2')}">𝕏 Twitter</button>
        <button id="dz-share-download" style="${_btnStyle('#8fd14f')}">📥 Download</button>
        <button id="dz-share-native" style="${_btnStyle('#c0202a')}">📤 Share</button>
        <button id="dz-share-close" style="${_btnStyle('#444')}">✕ Close</button>
      </div>
    </div>
  `;
  return el;
}

function _statBox(label, val, color) {
  return `
    <div style="background:rgba(255,255,255,0.04);border-radius:8px;padding:14px 8px;">
      <div style="font-size:0.65rem;letter-spacing:0.15em;color:#8a9090;text-transform:uppercase;">${label}</div>
      <div style="font-size:1.8rem;font-weight:900;color:${color};">${val}</div>
    </div>
  `;
}

function _btnStyle(bg) {
  return `background:${bg};color:#fff;border:none;border-radius:6px;padding:10px 18px;
    cursor:pointer;font-weight:700;font-size:0.85rem;font-family:inherit;`;
}

// ─── Show the share modal ─────────────────────────────────────────────────────
export async function showShareModal(gameCanvas, score, wave, kills, accuracy, onShare) {
  const blob    = await captureScreenshot(gameCanvas).catch(() => null);
  const overlay = buildShareOverlay(score, wave, kills, accuracy);
  document.body.appendChild(overlay);

  overlay.querySelector('#dz-share-twitter').onclick = () => {
    shareToTwitter(score, wave, kills);
    onShare?.();
  };
  overlay.querySelector('#dz-share-download').onclick = () => {
    if (blob) downloadScreenshot(blob, score, wave);
    onShare?.();
  };
  overlay.querySelector('#dz-share-native').onclick = async () => {
    await shareViaNative(blob, score, wave, kills);
    onShare?.();
  };
  overlay.querySelector('#dz-share-close').onclick = () => overlay.remove();
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
}
