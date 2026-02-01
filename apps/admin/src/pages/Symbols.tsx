import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function Symbols() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Symbol Watchlist</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-gray-500">
            Symbol management will be displayed here.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
