import { createFileRoute } from '@tanstack/react-router'
import { usePageTitle } from '@/hooks/use-page-title'
import { MissionsWorkSurface } from '@/screens/missions/missions-work-surface'

export const Route = createFileRoute('/missions')({
  component: function MissionsRoute() {
    usePageTitle('Missions')
    return <MissionsWorkSurface />
  },
})
