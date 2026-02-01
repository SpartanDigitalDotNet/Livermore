import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function ControlPanel() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Control Panel</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-gray-500">
            Runtime status and controls will be displayed here.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
