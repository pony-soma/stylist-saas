import MenuForm from '@/components/admin/MenuForm';

export default function EditMenuPage({ params }: { params: { id: string } }) {
  return <MenuForm menuId={params.id} />;
}
