import { Link } from 'react-router-dom';
import { PageHeader } from '../components/ui';
import { useSession } from '../lib/session';

export function NotFoundPage() {
  const { isPortal } = useSession();
  const home = isPortal ? '/portal' : '/';
  return (
    <PageHeader
      eyebrow="Lost"
      title="That page isn’t here"
      description="The job may have moved, or the link is out of date."
      actions={
        <Link to={home} className="rounded-xl bg-harbour px-4 py-2 text-sm font-semibold text-paper">
          {isPortal ? 'Back to your vehicles' : 'Back to workspace'}
        </Link>
      }
    />
  );
}
