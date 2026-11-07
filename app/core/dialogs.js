// Accessible replacements for window.confirm / window.alert.
// Built on <dialog>: focus is trapped by the browser, Escape cancels,
// and focus returns to the element that opened the dialog.
function openDialog({ title, message, actions, initialFocus }) {
  return new Promise((resolve) => {
    const trigger = document.activeElement;
    const dialog = document.createElement('dialog');
    dialog.className = 'modal confirm-dialog';
    dialog.setAttribute('role', 'alertdialog');
    const heading = document.createElement('h2');
    heading.id = 'dialog-title-' + Math.random().toString(36).slice(2);
    heading.textContent = title;
    const body = document.createElement('p');
    body.id = heading.id + '-body';
    body.className = 'confirm-dialog-message';
    body.textContent = message;
    dialog.setAttribute('aria-labelledby', heading.id);
    dialog.setAttribute('aria-describedby', body.id);
    const bar = document.createElement('div');
    bar.className = 'modal-actions';
    const buttons = actions.map(({ label, value, primary, danger }) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'button ' + (primary ? 'primary' : 'secondary') + (danger ? ' danger' : '');
      button.textContent = label;
      button.addEventListener('click', () => dialog.close(value));
      bar.append(button);
      return { button, value };
    });
    dialog.append(heading, body, bar);
    dialog.addEventListener('close', () => {
      const confirmed = dialog.returnValue === 'ok';
      dialog.remove();
      if (trigger instanceof HTMLElement && document.contains(trigger)) trigger.focus();
      resolve(confirmed);
    });
    // Click on the backdrop behaves like Cancel.
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close('cancel');
    });
    document.body.append(dialog);
    dialog.showModal();
    (buttons.find((item) => item.value === initialFocus) || buttons[0]).button.focus();
  });
}

export function confirmDialog(message, { title = 'Potwierdź', confirmLabel = 'Potwierdź', cancelLabel = 'Anuluj', danger = false } = {}) {
  return openDialog({
    title,
    message,
    // Destructive actions start focused on Cancel so Enter is the safe choice.
    initialFocus: danger ? 'cancel' : 'ok',
    actions: [
      { label: cancelLabel, value: 'cancel' },
      { label: confirmLabel, value: 'ok', primary: true, danger },
    ],
  });
}

export function noticeDialog(message, { title = 'Informacja', closeLabel = 'OK' } = {}) {
  return openDialog({
    title,
    message,
    initialFocus: 'ok',
    actions: [{ label: closeLabel, value: 'ok', primary: true }],
  });
}
