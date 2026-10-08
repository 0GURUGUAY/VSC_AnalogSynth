# Serveur local

- Demarrer ou redemarrer le serveur local Vite exclusivement sur le port 5173 avec `npm run dev -- --port 5173 --strictPort`.
- Ne jamais basculer automatiquement sur un autre port. Si le port 5173 est occupe, identifier le processus et signaler le conflit avant de poursuivre ; ne pas arreter un processus etranger au projet sans autorisation.
- Verifier que `http://localhost:5173/` repond apres chaque demarrage ou redemarrage.
