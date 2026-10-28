import { t, useLocale } from '../i18n';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button, Modal } from '@heroui/react';
import { cssTimeToMilliseconds } from '../utils/motion-time';
import './ConfirmationDialog.css';

interface ConfirmationDialogProps {
  triggerLabel: string;
  triggerIcon?: ReactNode;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => Promise<unknown>;
  confirmVariant?: 'danger' | 'primary';
  onOpen?: () => void;
  initialOpen?: 'pointer' | 'keyboard';
  onAfterClose?: () => void;
}

// Shared app confirmation UI. React Aria handles focus trapping, restoration and scroll locking.
export function ConfirmationDialog({ triggerLabel, triggerIcon, title, children, confirmLabel, onConfirm, confirmVariant = 'danger', onOpen, initialOpen, onAfterClose }: ConfirmationDialogProps) {
  useLocale();
  const [isOpen, setIsOpen] = useState(Boolean(initialOpen));
  const [animate, setAnimate] = useState(initialOpen === 'pointer');
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

  const animateExit = async (backdrop: HTMLElement) => {
    const surface = backdrop.querySelector<HTMLElement>('.virelo-confirm-container');
    const targets = [backdrop, ...(surface ? [surface] : [])].map(element => {
      const style = getComputedStyle(element);
      return { element, opacity: style.opacity, transform: style.transform };
    });
    const tokens = getComputedStyle(document.documentElement);
    const duration = animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? cssTimeToMilliseconds(tokens.getPropertyValue('--dur-micro')) : 0;
    // Return the actual exit work so the overlay never waits on a cancelled CSS entry transition.
    await Promise.all(targets.map(({element,opacity,transform}) => {
      element.style.transition = 'none';
      element.getAnimations?.().forEach(animation => animation.cancel());
      if (!duration || !element.animate) { element.style.opacity = '0'; return; }
      const frames = element === surface ? [{opacity,transform},{opacity:0,transform:'scale(.97)'}] : [{opacity},{opacity:0}];
      return element.animate(frames, {duration,easing:tokens.getPropertyValue('--ease-out').trim() || 'ease-out',fill:'forwards'}).finished.catch(()=>{});
    }));
    onAfterClose?.();
  };
  const changeOpen = (open: boolean) => {
    if (pending.current) return;
    if (open) onOpen?.();
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

  const dialog = <Modal.Backdrop className="virelo-confirm-backdrop" data-animate={animate} onExit={animateExit} isDismissable={!isPending} isKeyboardDismissDisabled={isPending}
    {...(initialOpen ? {isOpen,onOpenChange:changeOpen} : {})}
    UNSTABLE_portalContainer={document.fullscreenElement instanceof HTMLElement ? document.fullscreenElement : document.body}>
      <Modal.Container className="virelo-confirm-container" data-animate={animate} placement="center" size="sm" scroll="inside">
        <Modal.Dialog className="virelo-confirm-dialog" role={confirmVariant === 'danger' ? 'alertdialog' : 'dialog'} aria-describedby={descriptionId}>
          <Modal.Header className="virelo-confirm-header">
            <Modal.Heading className="virelo-confirm-title">{title}</Modal.Heading>
          </Modal.Header>
          <Modal.Body className="virelo-confirm-body">
            <div id={descriptionId} aria-busy={isPending} onKeyDown={event => { if (confirmVariant === 'primary' && event.key === 'Enter' && !event.nativeEvent.isComposing && (event.target as HTMLElement).tagName === 'INPUT') { event.preventDefault(); void submitConfirmation(); } }}>{children}</div>
            {isPending && <p className="virelo-confirm-progress" role="status">{t("Working…")}</p>}
            {error && <p className="virelo-confirm-error" role="alert">{t(error)}</p>}
          </Modal.Body>
          <Modal.Footer className="virelo-confirm-footer">
            <Button variant="secondary" autoFocus={confirmVariant === 'danger'} isDisabled={isPending} onPressStart={event=>{if(event.pointerType === 'keyboard') setAnimate(false);}} onPress={()=>changeOpen(false)}>{t("Cancel")}</Button>
            <Button variant={confirmVariant} className={confirmVariant === 'danger' ? 'virelo-confirm-action' : undefined} isPending={isPending} isDisabled={isPending} onPress={()=>void submitConfirmation()}>{confirmLabel}</Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>;
  return initialOpen ? dialog : <Modal isOpen={isOpen} onOpenChange={changeOpen}>
    <Button variant="secondary" onPressStart={event=>setAnimate(event.pointerType === 'mouse' || event.pointerType === 'touch' || event.pointerType === 'pen')}>{triggerIcon}{triggerLabel}</Button>
    {dialog}
  </Modal>;
}
