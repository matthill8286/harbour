import { useNavigate } from 'react-router-dom';
import { Button, Dialog, Text } from '@atomic-ui/ui-react';
import { useAuth } from '../../lib/auth';

/** Asks before signing out, as the Figma account menu says to. */
export function SignOutDialog({ onClose }: { onClose: () => void }) {
  const logout = useAuth((state) => state.logout);
  const navigate = useNavigate();
  return (
    <Dialog open heading="Sign out of Harbour?" onClose={onClose}>
      <Text>You will need your password and a code from your phone to sign back in.</Text>
      <div className="account-dialog-actions">
        <Button variant="secondary" onClick={onClose}>
          Stay signed in
        </Button>
        <Button
          variant="danger"
          iconBefore="log-out"
          onClick={() => {
            logout();
            navigate('/login', { replace: true });
          }}
        >
          Sign out
        </Button>
      </div>
    </Dialog>
  );
}
