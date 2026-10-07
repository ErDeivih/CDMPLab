(() => {
  'use strict';

  const labUrl = 'https://erdeivih.github.io/CDMPLab/library';
  const labOrigin = new URL(labUrl).origin;
  const selector = 'input[type="file"][name^="src-imagen-ejer["]';
  const maxBytes = 10 * 1024 * 1024;
  let active = null;

  function status(node, message, isError = false) {
    node.textContent = message;
    node.classList.toggle('cdmplab-error', isError);
  }

  function text(value, max = 4000) {
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
  }

  function relatedExercise(input) {
    let node = input.parentElement;
    while (node && node !== input.form) {
      if (
        node.querySelectorAll(selector).length === 1 &&
        node.querySelectorAll('textarea').length >= 3
      ) {
        return node;
      }
      node = node.parentElement;
    }
    return null;
  }

  function coachDraft(input) {
    const task = relatedExercise(input);
    if (!task) return null;
    const taskId = /\[(\d+)\]/.exec(input.name)?.[1] ?? '';
    const fields = [...task.querySelectorAll('input,textarea,select')].filter(
      (field) => !taskId || `${field.name} ${field.id}`.includes(taskId),
    );
    const namedValue = (pattern) => {
      const matches = fields.filter(
        (field) => pattern.test(`${field.name} ${field.id}`) && field.type !== 'file',
      );
      return matches.length === 1 ? text(matches[0].value) : '';
    };
    const areas = [...task.querySelectorAll('textarea')];
    // La captura de Coach muestra exactamente tres cajas, en este orden.
    // Si cambia el formulario, no se adivina: solo se usan nombres inequívocos.
    const ordered = areas.length === 3 ? areas : [];
    const development = namedValue(/desarrollo/i) || text(ordered[0]?.value);
    const aspects = namedValue(/aspectos|incidir/i) || text(ordered[1]?.value);
    const progression = namedValue(/progresi[oó]n/i) || text(ordered[2]?.value);
    const titleFromInput = namedValue(/nombre|t[ií]tulo/i);
    const titleElements = [...task.querySelectorAll('h2,h3,h4,[class*="title"],[class*="nombre"]')]
      .map((element) => text(element.textContent, 160))
      .filter(
        (value) =>
          value && !/nuevo ejercicio|configuraci[oó]n|desarrollo|progresi[oó]n/i.test(value),
      );
    const title = titleFromInput || (titleElements.length === 1 ? titleElements[0] : '');
    const playersText = namedValue(/^jugadores(?:\b|[-_\[])/i);
    const players = /^\d{1,2}$/.test(playersText) ? Number(playersText) : null;
    // No se copia «Tiempo/rep» ni el volumen de la sesión como duración del ejercicio.
    return {
      title,
      development,
      aspects,
      progression,
      players: players && players <= 99 ? players : null,
      durationMinutes: null,
    };
  }

  function installButton(input) {
    if (input.dataset.cdmplabBridge === 'ready') return;
    input.dataset.cdmplabBridge = 'ready';
    const row = document.createElement('div');
    row.className = 'cdmplab-coach-row';
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Crear en CDMPLab';
    button.className = 'cdmplab-coach-button';
    const message = document.createElement('span');
    message.className = 'cdmplab-coach-status';
    message.setAttribute('role', 'status');
    row.append(button, message);
    input.insertAdjacentElement('afterend', row);

    button.addEventListener('click', () => {
      if (active?.popup.closed) active = null;
      if (active?.input === input) {
        active = null;
        button.textContent = 'Crear en CDMPLab';
        status(message, 'Conexión cancelada. Puedes iniciar otra.');
        return;
      }
      if (active) {
        status(message, 'Termina primero la otra imagen.', true);
        return;
      }
      const nonce = crypto.randomUUID();
      const popup = window.open(labUrl + '?coachTransfer=' + nonce, '_blank');
      if (!popup) {
        status(message, 'Brave bloqueó la pestaña. Permite abrirla y reintenta.', true);
        return;
      }
      active = {
        input,
        form: input.form,
        originalFile: input.files?.item(0) ?? null,
        draft: coachDraft(input),
        nonce,
        popup,
        message,
        button,
      };
      button.textContent = 'Cancelar conexión';
      status(message, 'Dibuja en CDMPLab y usa «Guardar y enviar a Coach».');
    });
  }

  function findInputs() {
    document.querySelectorAll(selector).forEach(installButton);
  }

  window.addEventListener('message', (event) => {
    const target = active;
    if (!target || event.origin !== labOrigin || event.source !== target.popup) return;
    const data = event.data;
    if (data?.kind === 'CDMPLAB_COACH_READY' && data.nonce === target.nonce) {
      target.popup.postMessage(
        { kind: 'CDMPLAB_COACH_DRAFT', nonce: target.nonce, draft: target.draft ?? {} },
        labOrigin,
      );
      return;
    }
    if (data?.kind !== 'CDMPLAB_COACH_PNG' || data.nonce !== target.nonce) return;

    const fail = (message) => {
      status(target.message, message, true);
      target.popup.postMessage(
        { kind: 'CDMPLAB_COACH_ACK', nonce: target.nonce, success: false },
        labOrigin,
      );
      target.button.textContent = 'Crear en CDMPLab';
      active = null;
    };
    if (!target.input.isConnected || target.input.form !== target.form) {
      fail('La tarea cambió o se cerró. Ábrela y vuelve a intentarlo.');
      return;
    }
    if ((target.input.files?.item(0) ?? null) !== target.originalFile) {
      fail('Elegiste otro archivo mientras dibujabas. No se ha sustituido.');
      return;
    }
    if (typeof data.dataUrl !== 'string' || !data.dataUrl.startsWith('data:image/png;base64,')) {
      fail('No se recibió un PNG válido.');
      return;
    }
    try {
      const encoded = data.dataUrl.slice('data:image/png;base64,'.length);
      if (encoded.length > maxBytes * 1.4) throw new Error('too_large');
      const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
      if (bytes.length > maxBytes) throw new Error('too_large');
      const name =
        typeof data.fileName === 'string' && /^[\wÀ-ÿ .()-]{1,120}\.png$/i.test(data.fileName)
          ? data.fileName
          : 'cdmplab-ejercicio.png';
      const file = new File([bytes], name, { type: 'image/png' });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      target.input.files = transfer.files;
      target.input.dispatchEvent(new Event('input', { bubbles: true }));
      target.input.dispatchEvent(new Event('change', { bubbles: true }));
      status(target.message, 'PNG seleccionado. Pulsa «Aplicar» y después «Guardar».');
      target.popup.postMessage(
        { kind: 'CDMPLAB_COACH_ACK', nonce: target.nonce, success: true },
        labOrigin,
      );
      target.button.textContent = 'Crear en CDMPLab';
      active = null;
      window.focus();
    } catch {
      fail('No se pudo adjuntar el PNG. Descárgalo desde CDMPLab y selecciónalo a mano.');
    }
  });

  findInputs();
  new MutationObserver(findInputs).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
})();
