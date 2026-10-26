import { Fragment, type ReactNode } from 'react';
import { t, useLocale } from './index';

export function Trans({ message, values }: { message: string; values: Record<string, ReactNode> }) {
  useLocale();
  return t(message).split(/(\{\w+\})/g).map((part, index) => {
    const name = part.slice(1,-1);
    return <Fragment key={index}>{part.startsWith('{') && Object.hasOwn(values,name) ? values[name] : part}</Fragment>;
  });
}
