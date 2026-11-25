import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter/index.css';
import { AdminShell } from './shell.js';
import './styles.css';
import './ui/ui.css';

createRoot(document.getElementById('root')!).render(<AdminShell />);
