# Maintenir Vercel et Supabase en état de fonctionnement

## 1. Sources de vérité

| Responsabilité | Référence à maintenir |
| --- | --- |
| URL publique, délais, reprises, réponses attendues | [`config/operations.json`](../../config/operations.json) |
| Contrôle des trois services | [`scripts/ops/check-health.mjs`](../../scripts/ops/check-health.mjs) |
| Tables, colonnes, rôles et fonctions nécessaires | [`api/_lib/dal/health-contract.ts`](../../api/_lib/dal/health-contract.ts) |
| Schéma initial, puis migrations incrémentales | [`supabase/schema.sql`](../../supabase/schema.sql), [`supabase/migrations/`](../../supabase/migrations/) ; historique effectif : `public._dal_migrations` |
| Version Node et compilation | [`.nvmrc`](../../.nvmrc), [`package.json`](../../package.json), [`vercel.json`](../../vercel.json) |
| Contrôles automatiques et mises à jour | [CI](../../.github/workflows/ci.yml), [surveillance quotidienne](../../.github/workflows/supabase-keepalive.yml), [Dependabot](../../.github/dependabot.yml) |

Production : [Minis Wettstetten](https://ministranten-wett.vercel.app), projet Vercel `ministranten-wett`, branche `main`, Node **24.x**. Base et authentification : projet Supabase `uvsgzvzttsohcmsnfgla`, API [Supabase du projet](https://uvsgzvzttsohcmsnfgla.supabase.co), [tableau de bord](https://supabase.com/dashboard/project/uvsgzvzttsohcmsnfgla).

Les variables secrètes restent dans Vercel ou dans un stockage local privé exclu de Git. Les noms attendus sont documentés dans [`.env.example`](../../.env.example). Ne jamais copier de jeton, mot de passe, clé `service_role` ou sauvegarde dans ce guide, un ticket ou un rapport de contrôle.

Les fonctions Vercel sont configurées dans `vercel.json` pour Francfort (`fra1`),
à proximité de Supabase (`eu-central-1`). La configuration du dépôt prend effet
au déploiement. [Régions des fonctions Vercel](https://vercel.com/docs/functions/configuring-functions/region).

## 2. État vérifié le 8 septembre 2026

- Supabase était `ACTIVE_HEALTHY` ; 4 comptes et 1 service étaient présents. Aucun détail personnel n'est nécessaire au diagnostic.
- Le schéma existant et `0002_dal_atomic_rpc.sql` étaient déjà appliqués. La somme SHA-256 enregistrée correspondait au fichier local : `221745bc2ee859d0d7564ffe6862fdcfd522f093323d4ce3dd585df35300caba`. **Ne pas réexécuter le schéma initial pour une remise en route.**
- Supabase Auth : `Site URL` a été corrigée de `http://localhost:3000` vers `https://ministranten-wett.vercel.app` ; `uri_allow_list` contient l'URL exacte `https://ministranten-wett.vercel.app/?backend=cloud`.
- Les trois contrôles publics ont répondu `PASS` : site, base, authentification. Ce résultat décrit leur disponibilité à cet instant.
- Google, GitHub et Microsoft OAuth ne disposent pas des identifiants et secrets clients nécessaires dans Supabase. Le parcours existant par mot de passe reste le moyen de connexion disponible. L'accès GitHub au dépôt ne configure pas une application OAuth Supabase.

Les correctifs de cette intervention ajoutent au dépôt une vérification de six tables et de leurs colonnes, des trois rôles `user`, `admin`, `dev`, des huit RPC via leur catalogue OpenAPI et de Supabase Auth. Les RPC sont vérifiées dans le catalogue, sans exécuter leurs écritures. **La présence de ces correctifs dans le dépôt ne confirme pas leur déploiement** : relever le commit du déploiement Vercel et refaire les contrôles après publication.

## 3. Contrôle courant

Depuis la racine du projet, avec Node 24 :

```sh
npm run ops:check
```

Le résultat attendu est trois lignes `PASS` et un code de sortie `0`. Toute ligne `FAIL` produit un code non nul. Aucun identifiant n'est requis. `APP_BASE_URL` permet de contrôler une autre origine ; l'ancien remplacement `HEALTH_URL` reste accepté. Sans remplacement, la configuration du dépôt s'applique.

Le workflow **Supabase Keepalive** est programmé chaque jour à **06:17 UTC**. Il exige les vrais contenus attendus, limite chaque tentative à 15 secondes et essaie jusqu'à trois fois. Pour le lancer dans Chrome : dépôt GitHub → **Actions → Supabase Keepalive → Run workflow**. Contrôler le résultat et activer les notifications d'échec dans les préférences GitHub du responsable.

Le cron GitHub peut être retardé et certaines exécutions peuvent être perdues en période de charge ; vérifier également la date du dernier passage. Dans un dépôt public, GitHub désactive les workflows planifiés après 60 jours sans activité du dépôt. Vérifier leur activation chaque mois ; si nécessaire, ouvrir le workflow dans **Actions**, choisir **Enable workflow**, puis lancer **Run workflow**. [Planification GitHub](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule), [réactivation d'un workflow](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows).

Supabase Free peut mettre en pause un projet dont l'activité est faible sur sept jours. Nos sondes constituent une surveillance, sans garantie contre cette pause. Lire les avertissements envoyés au propriétaire du projet. Si une disponibilité continue est nécessaire, étudier un plan supprimant la pause pour inactivité avant de prendre un engagement. [Règles de pause Supabase](https://supabase.com/docs/guides/platform/free-project-pausing).

## 4. Réagir à un échec

| Échec | Vérification et action |
| --- | --- |
| `website` | Dans Vercel, vérifier le dernier déploiement Production, son commit `main`, la compilation, le domaine et les journaux. Restaurer un déploiement connu fonctionnel si la régression vient du code. |
| `database` | Vérifier d'abord l'état Supabase. Si le projet est en pause, utiliser **Resume project**, attendre son retour à un état sain puis relancer le contrôle. Sinon examiner la configuration Vercel, les droits et la migration signalée par les journaux. |
| `authentication` | Contrôler Supabase Auth, l'URL du projet, les clés attendues dans Vercel et les URL de redirection. Pour OAuth, configurer chaque fournisseur avec ses propres identifiants clients, puis tester une connexion complète. |
| Aucun passage récent | Vérifier l'activation du workflow et la branche par défaut ; relancer manuellement. Un ancien résultat vert ne prouve pas l'état actuel. |

Après toute correction, relancer `npm run ops:check`, puis vérifier dans Chrome une connexion, l'affichage des services et la déconnexion. Les sondes seules ne prouvent pas un parcours utilisateur complet.

## 5. Mettre à jour et sauvegarder

1. Examiner chaque semaine les propositions Dependabot pour npm, et chaque mois celles des actions GitHub. Vérifier les changements incompatibles avant de mettre à jour les versions majeures.
2. Avant toute nouvelle migration, exporter séparément les rôles, le schéma et les données avec **Supabase CLI `db dump`**, suivant le [guide officiel de sauvegarde et restauration](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore). Conserver aussi les paramètres Auth nécessaires à la restauration. Stocker ces éléments dans un emplacement privé hors Git et vérifier une restauration dans un environnement isolé.
3. Sauvegarder séparément les fichiers de Supabase Storage, s'il y en a : une sauvegarde de base contient leurs métadonnées, **pas les objets Storage**. Prévoir des exports réguliers sur le plan Free. [Portée des sauvegardes Supabase](https://supabase.com/docs/guides/platform/backups).
4. Ajouter une nouvelle migration numérotée pour une évolution du schéma. Ne pas modifier une migration déjà enregistrée ni supprimer son historique pour contourner un désaccord de checksum. `npm run db:migrate` utilise les identifiants administratifs fournis à l'environnement et refuse les migrations modifiées ; ne le lancer que pour une évolution préparée et sauvegardée.
5. Exécuter `npm ci`, `npm run typecheck`, `npm run build`, `npm run test:unit` et les tests E2E. Après validation et publication de `main`, vérifier le commit et l'état **Ready** de la production Vercel, puis refaire le contrôle public et le parcours Chrome.

Les sauvegardes régulières, leur restauration d'essai, les notifications de l'opérateur et la configuration OAuth sont des actions d'exploitation à réaliser et à consigner ; leur exécution n'est pas attestée par ce document.
