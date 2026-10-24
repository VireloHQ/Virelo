import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button, Modal } from '@heroui/react';
import './ConfirmationDialog.css';

interface ConfirmationDialogProps {
  triggerLabel: string;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => Promise<unknown>;
}

// Shared app confirmation UI. React Aria handles focus trapping, restoration and scroll locking.
export function ConfirmationDialog({ triggerLabel, title, children, confirmLabel, onConfirm }: ConfirmationDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [animate, setAnimate] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const descriptionId = useId();

  useEffect(() => {
    if (!isOpen) return;
    const dismissWithKeyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pending.current) setAnimate(false);
    };
    document.addEventListener('keydown', dismissWithKeyboard, true);
    return () => document.removeEventListener('keydown', dismissWithKeyboard, true);
  }, [isOpen]);

  const changeOpen = (open: boolean) => {
    if (pending.current) return;
    setError('');
    setIsOpen(open);
  };

  const submitConfirmation = async () => {
    if (pending.current) return;
    pending.current = true;
    setIsPending(true);
    setError('');
    try {
      await onConfirm();
      setIsOpen(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not complete this action. Please try again.');
    } finally {
      pending.current = false;
      setIsPending(false);
    }
  };

  return <Modal isOpen={isOpen} onOpenChange={changeOpen}>
    <Button variant="secondary" onPressStart={event=>setAnimate(event.pointerType === 'mouse' || event.pointerType === 'touch' || event.pointerType === 'pen')}>{triggerLabel}</Button>
    <Modal.Backdrop className="virelo-confirm-backdrop" data-animate={animate} isDismissable={!isPending} isKeyboardDismissDisabled={isPending}>
      <Modal.Container className="virelo-confirm-container" data-animate={animate} placement="center" size="sm" scroll="inside">
        <Modal.Dialog className="virelo-confirm-dialog" role="alertdialog" aria-describedby={descriptionId}>
          <Modal.Header className="virelo-confirm-header">
            <Modal.Heading className="virelo-confirm-title">{title}</Modal.Heading>
          </Modal.Header>
          <Modal.Body className="virelo-confirm-body">
            <div id={descriptionId} aria-busy={isPending}>{children}</div>
            {isPending && <p className="virelo-confirm-progress" role="status">Working…</p>}
            {error && <p className="virelo-confirm-error" role="alert">{error}</p>}
          </Modal.Body>
          <Modal.Footer className="virelo-confirm-footer">
            <Button variant="secondary" autoFocus isDisabled={isPending} onPressStart={event=>{if(event.pointerType === 'keyboard') setAnimate(false);}} onPress={()=>changeOpen(false)}>Cancel</Button>
            <Button variant="danger" className="virelo-confirm-action" isPending={isPending} isDisabled={isPending} onPress={()=>void submitConfirmation()}>{confirmLabel}</Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  </Modal>;
}
