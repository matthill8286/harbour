import { Link } from 'react-router-dom';
import { PageHeader } from '../components/ui';

export function NotFoundPage() {
  return (
    <PageHeader
      eyebrow="Lost"
      title="That page isn’t here"
      description="The job may have moved, or the link is out of date."
      actions={
        <Link to="/" className="rounded-xl bg-harbour px-4 py-2 text-sm font-semibold text-paper">
          Back to the desk
        </Link>
      }
    />
  );
}
