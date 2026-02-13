import { AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface LockWarningModalProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  hostname: string;
  ipAddress: string | null;
  connectedAt: string | null;
  exchangeName: string;
}

/**
 * LockWarningModal Component
 *
 * Warning dialog shown when attempting to connect to an exchange
 * that is already running on another machine. Displays the current
 * lock holder's hostname, IP address, and connection timestamp.
 *
 * Requires explicit confirmation before proceeding with takeover.
 *
 * Requirements:
 * - ADM-02: Show lock holder info (hostname, IP, connected-since)
 * - ADM-02: Require explicit confirmation before takeover
 */
export function LockWarningModal({
  open,
  onConfirm,
  onCancel,
  hostname,
  ipAddress,
  connectedAt,
}: LockWarningModalProps) {
  /**
   * Format connectedAt timestamp to human-readable local time.
   */
  const formatConnectedAt = (timestamp: string | null): string => {
    if (!timestamp) return 'Unknown';
    try {
      return new Date(timestamp).toLocaleString();
    } catch {
      return 'Unknown';
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Exchange Already Connected
          </DialogTitle>
          <DialogDescription>
            This exchange is currently connected on another machine.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md bg-amber-50 border border-amber-200 p-4 space-y-2">
          <div className="grid grid-cols-[120px_1fr] gap-2 text-sm">
            <span className="font-medium text-amber-900">Hostname:</span>
            <span className="text-amber-800">{hostname}</span>

            <span className="font-medium text-amber-900">IP Address:</span>
            <span className="text-amber-800">{ipAddress ?? 'Unknown'}</span>

            <span className="font-medium text-amber-900">Connected since:</span>
            <span className="text-amber-800">
              {formatConnectedAt(connectedAt)}
            </span>
          </div>
        </div>

        <p className="text-sm text-gray-700">
          <span className="font-medium">Warning:</span> Connecting from here
          will take over the exchange. The other instance will lose its
          connection.
        </p>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Connect Anyway
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
