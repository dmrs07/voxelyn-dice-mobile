import './style.css';
import { bootstrapApp } from './app/bootstrap';

void bootstrapApp().catch((error) => {
  const root = document.getElementById('app');
  if (!root) {
    throw error;
  }

  root.innerHTML = `
    <main class="screen">
      <h1>Falha ao iniciar</h1>
      <pre class="error-box">${(error as Error).message}</pre>
    </main>
  `;
});
