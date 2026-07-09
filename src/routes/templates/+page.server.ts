import type { PageServerLoad } from './$types';
import { templateList } from '$lib/server/templates';

export const load: PageServerLoad = () => ({
	templates: templateList.map((t) => ({ id: t.id, name: t.name, description: t.description }))
});
