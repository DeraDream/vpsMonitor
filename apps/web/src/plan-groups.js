export function groupPlans(plans, categories = []) {
  const groups = new Map(categories.map(category => [category.id, { ...category, plans: [] }]));
  for (const plan of plans) {
    const id = plan.categoryId || 'other';
    if (!groups.has(id)) groups.set(id, { id, name: plan.categoryName || '套餐', plans: [] });
    groups.get(id).plans.push(plan);
  }
  return [...groups.values()];
}
