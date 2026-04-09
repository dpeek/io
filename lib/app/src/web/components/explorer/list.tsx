import { Card, CardContent, CardHeader, CardTitle } from "@io/web/card";
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@io/web/item";
import { cn } from "@io/web/utils";
import type { ReactNode } from "react";

type ListItemData = {
  icon?: ReactNode;
  title: string;
  description?: string;
};

function ListItem({
  item,
  onClick,
  selected,
}: {
  item: ListItemData;
  onClick?: () => void;
  selected: boolean;
}) {
  return (
    <Item
      onClick={onClick}
      className={cn("select-none cursor-pointer hover:bg-muted rounded-none", {
        "bg-muted": selected,
      })}
    >
      {item.icon ? <ItemMedia>{item.icon}</ItemMedia> : null}
      <ItemContent>
        <ItemTitle>{item.title}</ItemTitle>
        {item.description ? <ItemDescription>{item.description}</ItemDescription> : null}
      </ItemContent>
    </Item>
  );
}

export function List({
  title,
  items,
  selectedIndex,
  onSelect,
}: {
  title: string;
  items: readonly ListItemData[];
  selectedIndex?: number;
  onSelect?: (index: number) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-0 overflow-y-auto">
        {items.map((item, index) => (
          <ListItem
            key={index}
            item={item}
            onClick={() => onSelect?.(index)}
            selected={index === selectedIndex}
          />
        ))}
      </CardContent>
    </Card>
  );
}
