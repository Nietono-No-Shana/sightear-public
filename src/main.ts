import { mountApp } from './ui/app';

const root = document.querySelector<HTMLElement>('#app');
if (root === null) {
  throw new Error('missing #app');
}

void mountApp(root);
