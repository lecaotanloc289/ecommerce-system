'use client';

import * as React from 'react';
import {
  CheckCircle2,
  Info,
  AlertTriangle,
  XCircle,
  ShoppingCart,
  Heart,
  Search,
  Trash2,
} from 'lucide-react';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Checkbox,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
  Input,
  Label,
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
  Popover,
  PopoverContent,
  PopoverTrigger,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tag,
  Textarea,
  Toaster,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  toast,
} from '@repo/ui';

function Section({
  title,
  children,
  description,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-[var(--color-border-subtle)] py-12 first:border-t-0">
      <div className="mb-6">
        <h2 className="text-[var(--text-h2)] leading-[var(--leading-h2)] font-bold tracking-tight">
          {title}
        </h2>
        {description ? (
          <p className="mt-1 text-[var(--text-body-m)] text-[var(--color-text-muted)]">
            {description}
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-8">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-[140px_1fr] md:items-center">
      <div className="text-[var(--text-body-s)] font-medium text-[var(--color-text-muted)]">
        {label}
      </div>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

export default function DesignSystemPage() {
  const variants = [
    'primary',
    'secondary',
    'ghost',
    'destructive',
    'outline',
    'dark',
    'link',
  ] as const;
  const sizes = ['sm', 'md', 'lg', 'xl'] as const;

  return (
    <TooltipProvider delayDuration={150}>
      <Toaster />
      <main className="mx-auto max-w-[var(--container-max)] px-6 py-12">
        <header className="mb-12">
          <h1 className="text-[var(--text-display-l)] leading-[var(--leading-display-l)] font-bold tracking-tight">
            Elma Design System
          </h1>
          <p className="mt-2 text-[var(--text-body-l)] text-[var(--color-text-body)]">
            Live preview of every base component in <code>@repo/ui</code>. Tokens come from
            <code> packages/ui/src/styles/tokens.css</code>.
          </p>
        </header>

        {/* TYPOGRAPHY */}
        <Section
          title="Typography"
          description="Rubik (heading) + Roboto (body). 8 heading styles + body + caption. Each heading ships Bold / Medium / Regular weights and a smaller alt size (where defined in Figma)."
        >
          {[
            { level: 'H1', size: 56, leading: 72, hasAlt: true, altSize: 48, altLeading: 64 },
            { level: 'H2', size: 40, leading: 56, hasAlt: true, altSize: 36, altLeading: 52 },
            { level: 'H3', size: 32, leading: 48, hasAlt: true, altSize: 28, altLeading: 44 },
            { level: 'H4', size: 24, leading: 32, hasAlt: true, altSize: 22, altLeading: 30 },
            { level: 'H5', size: 20, leading: 24 },
            { level: 'H6', size: 18, leading: 20 },
            { level: 'H7', size: 16, leading: 20 },
            { level: 'H8', size: 14, leading: 20 },
            { level: 'H9', size: 12, leading: 16 },
          ].map((row) => (
            <div
              key={row.level}
              className="grid grid-cols-1 gap-4 border-b border-[var(--color-border-subtle)] pb-6 last:border-b-0 md:grid-cols-[100px_1fr_120px] md:items-baseline"
            >
              <div>
                <div className="text-[var(--text-h7)] font-semibold text-[var(--color-text-link)]">
                  {row.level}
                </div>
                <div className="text-[var(--text-h9)] text-[var(--color-text-muted)]">
                  {row.size}/{row.leading}px
                </div>
              </div>
              <div className="space-y-2">
                <div
                  className="font-bold"
                  style={{ fontSize: `${row.size}px`, lineHeight: `${row.leading}px` }}
                >
                  User Interface Design — Bold
                </div>
                <div
                  className="font-medium"
                  style={{ fontSize: `${row.size}px`, lineHeight: `${row.leading}px` }}
                >
                  User Interface Design — Medium
                </div>
                <div
                  className="font-normal"
                  style={{ fontSize: `${row.size}px`, lineHeight: `${row.leading}px` }}
                >
                  User Interface Design — Regular
                </div>
                {row.hasAlt && row.altSize && row.altLeading ? (
                  <div className="border-t border-[var(--color-border-subtle)] pt-2 text-[var(--color-text-muted)]">
                    <div className="text-[var(--text-h9)] mb-1">
                      alt {row.altSize}/{row.altLeading}px
                    </div>
                    <div
                      className="font-bold text-[var(--color-text-primary)]"
                      style={{ fontSize: `${row.altSize}px`, lineHeight: `${row.altLeading}px` }}
                    >
                      User Interface Design
                    </div>
                  </div>
                ) : null}
              </div>
              <code className="text-[var(--text-h9)] text-[var(--color-text-muted)]">
                text-{row.level.toLowerCase()}
              </code>
            </div>
          ))}
        </Section>

        {/* COLORS */}
        <Section
          title="Colors"
          description="Polaris-style palette confirmed from Figma. 12-step scales for neutral + brand + status + accents; semantic tokens layered on top."
        >
          <div>
            <h3 className="mb-3 text-[var(--text-h6)] font-semibold">
              Fill Action (solid anchors)
            </h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
              {[
                { name: 'Blue', hex: '#006FBB', token: 'info-9' },
                { name: 'Purple', hex: '#9C6ADE', token: 'purple-9' },
                { name: 'Indigo', hex: '#5C6AC4', token: 'indigo-9 (brand)' },
                { name: 'Teal', hex: '#47C1BF', token: 'teal-9' },
                { name: 'Green', hex: '#50B83C', token: 'success-9' },
                { name: 'Yellow', hex: '#EEC200', token: 'warning-9' },
                { name: 'Orange', hex: '#F49342', token: 'orange-9' },
                { name: 'Red', hex: '#DE3618', token: 'danger-9' },
              ].map((c) => (
                <div key={c.name}>
                  <div
                    className="h-16 w-full rounded-[var(--radius-md)] border border-[var(--color-border-subtle)]"
                    style={{ backgroundColor: c.hex }}
                  />
                  <div className="mt-2 text-[var(--text-h8)] font-semibold">{c.hex}</div>
                  <div className="text-[var(--text-h9)] text-[var(--color-text-muted)]">
                    {c.name} · {c.token}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="mb-3 text-[var(--text-h6)] font-semibold">Dark Fill (neutral text)</h3>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
              {[
                { name: 'Tittle', hex: '#161B25', token: 'slate-12' },
                { name: 'Ink', hex: '#212B36', token: 'slate-11' },
                { name: 'Light', hex: '#454F5B', token: 'slate-10' },
                { name: 'Lighter', hex: '#637381', token: 'slate-9' },
                { name: 'Lightest', hex: '#919EAB', token: 'slate-8' },
              ].map((c) => (
                <div key={c.name}>
                  <div
                    className="h-16 w-full rounded-[var(--radius-md)]"
                    style={{ backgroundColor: c.hex }}
                  />
                  <div className="mt-2 text-[var(--text-h8)] font-semibold">{c.hex}</div>
                  <div className="text-[var(--text-h9)] text-[var(--color-text-muted)]">
                    {c.name} · {c.token}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="mb-3 text-[var(--text-h6)] font-semibold">White Fill (surface)</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { name: 'Dark Light', hex: '#C4CDD5', token: 'slate-6' },
                { name: 'Sky', hex: '#DFE3E8', token: 'slate-4' },
                { name: 'Enough Light', hex: '#F4F6F8', token: 'slate-2' },
                { name: 'Lighter', hex: '#F9FAFB', token: 'slate-1' },
              ].map((c) => (
                <div key={c.name}>
                  <div
                    className="h-16 w-full rounded-[var(--radius-md)] border border-[var(--color-border-subtle)]"
                    style={{ backgroundColor: c.hex }}
                  />
                  <div className="mt-2 text-[var(--text-h8)] font-semibold">{c.hex}</div>
                  <div className="text-[var(--text-h9)] text-[var(--color-text-muted)]">
                    {c.name} · {c.token}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="mb-3 text-[var(--text-h6)] font-semibold">Fill Light (pastel tints)</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
              {[
                { name: 'Blue', hex: '#D6EDF7', token: 'tint-blue' },
                { name: 'Purple', hex: '#EEDFFA', token: 'tint-purple' },
                { name: 'Indigo', hex: '#ECEEFB', token: 'tint-indigo' },
                { name: 'Teal', hex: '#CFE6E6', token: 'tint-teal' },
                { name: 'Green', hex: '#DFEFD3', token: 'tint-green' },
                { name: 'Yellow', hex: '#FCF1CD', token: 'tint-yellow' },
                { name: 'Orange', hex: '#FCE5D0', token: 'tint-orange' },
                { name: 'Red', hex: '#FBE5DF', token: 'tint-red' },
              ].map((c) => (
                <div key={c.name}>
                  <div
                    className="h-16 w-full rounded-[var(--radius-md)] border border-[var(--color-border-subtle)]"
                    style={{ backgroundColor: c.hex }}
                  />
                  <div className="mt-2 text-[var(--text-h8)] font-semibold">{c.hex}</div>
                  <div className="text-[var(--text-h9)] text-[var(--color-text-muted)]">
                    {c.name} · {c.token}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Section>

        {/* LAYOUT */}
        <Section
          title="Layout grid"
          description="Container max 1100 px (Figma). Column gutter 30 px constant. 2/3/4-column formulas."
        >
          {[
            { name: '3-col', tracks: [350, 350, 350] },
            { name: '3-col asymmetric', tracks: [350, 730] },
            { name: '3-col asymmetric', tracks: [730, 350] },
            { name: '4-col', tracks: [255, 255, 255, 255] },
            { name: '4-col asymmetric', tracks: [255, 255, 540] },
            { name: '4-col asymmetric', tracks: [255, 825] },
            { name: '2-col', tracks: [540, 540] },
          ].map((row, i) => (
            <div key={i}>
              <div className="mb-2 flex items-baseline justify-between">
                <span className="text-[var(--text-h8)] font-semibold">{row.name}</span>
                <span className="text-[var(--text-h9)] text-[var(--color-text-muted)]">
                  {row.tracks.join(' + ')} = {row.tracks.reduce((a, b) => a + b, 0)} px (gap 30)
                </span>
              </div>
              <div className="flex gap-[30px]">
                {row.tracks.map((t, j) => (
                  <div
                    key={j}
                    className="h-16 rounded-[var(--radius-md)] bg-[var(--color-slate-3)]"
                    style={{ width: `${(t / 1100) * 100}%` }}
                  />
                ))}
              </div>
            </div>
          ))}
        </Section>

        {/* BUTTON */}
        <Section
          title="Button"
          description="6 variants × 4 sizes × 4 states. Slot + loading + icon-left/right supported."
        >
          {variants.map((variant) => (
            <Row key={variant} label={variant}>
              {sizes.map((size) => (
                <Button key={size} variant={variant} size={size}>
                  {size.toUpperCase()}
                </Button>
              ))}
            </Row>
          ))}
          <Row label="states">
            <Button>Default</Button>
            <Button disabled>Disabled</Button>
            <Button loading>Loading</Button>
            <Button iconLeft={<ShoppingCart />}>Add to cart</Button>
            <Button variant="secondary" iconRight={<Heart />}>
              Wishlist
            </Button>
            <Button size="icon" aria-label="search">
              <Search />
            </Button>
          </Row>
          <Row label="full width">
            <div className="w-full max-w-md">
              <Button fullWidth size="lg">
                Continue to Shipping
              </Button>
            </div>
          </Row>
        </Section>

        {/* INPUT */}
        <Section title="Input / Textarea / Label">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="ds-email">Email</Label>
              <Input id="ds-email" type="email" placeholder="name@mail.com" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="ds-name">Name</Label>
              <Input id="ds-name" defaultValue="Gareth Barry" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="ds-disabled">Disabled</Label>
              <Input id="ds-disabled" disabled placeholder="locked" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="ds-invalid">Invalid</Label>
              <Input id="ds-invalid" invalid defaultValue="bad value" />
              <span className="text-[var(--text-body-s)] text-[var(--color-danger-fg)]">
                Required field.
              </span>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="ds-sm">Small</Label>
              <Input id="ds-sm" size="sm" placeholder="sm" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="ds-lg">Large</Label>
              <Input id="ds-lg" size="lg" placeholder="lg" />
            </div>
            <div className="flex flex-col gap-2 md:col-span-2">
              <Label htmlFor="ds-review">Write your review</Label>
              <Textarea id="ds-review" placeholder="The product is..." />
            </div>
          </div>
        </Section>

        {/* SELECTION CONTROLS */}
        <Section title="Checkbox / Radio / Switch / Select">
          <Row label="checkbox">
            <label className="flex items-center gap-2">
              <Checkbox defaultChecked /> Checked
            </label>
            <label className="flex items-center gap-2">
              <Checkbox /> Unchecked
            </label>
            <label className="flex items-center gap-2">
              <Checkbox checked="indeterminate" /> Indeterminate
            </label>
            <label className="flex items-center gap-2">
              <Checkbox disabled defaultChecked /> Disabled
            </label>
          </Row>
          <Row label="radio">
            <RadioGroup defaultValue="dhl" className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2">
                <RadioGroupItem value="dhl" /> DHL Express
              </label>
              <label className="flex items-center gap-2">
                <RadioGroupItem value="fedex" /> FedEx
              </label>
              <label className="flex items-center gap-2">
                <RadioGroupItem value="jne" /> JNE Express
              </label>
              <label className="flex items-center gap-2">
                <RadioGroupItem value="pos" disabled /> POS (disabled)
              </label>
            </RadioGroup>
          </Row>
          <Row label="switch">
            <label className="flex items-center gap-2">
              <Switch defaultChecked /> Stay signed in
            </label>
            <label className="flex items-center gap-2">
              <Switch /> Newsletter
            </label>
            <label className="flex items-center gap-2 opacity-60">
              <Switch disabled defaultChecked /> Disabled
            </label>
          </Row>
          <Row label="select">
            <div className="w-64">
              <Select>
                <SelectTrigger>
                  <SelectValue placeholder="Choose category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="phones">Phones</SelectItem>
                  <SelectItem value="laptops">Laptops</SelectItem>
                  <SelectItem value="audio">Audio</SelectItem>
                  <SelectItem value="wearables">Wearables</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </Row>
        </Section>

        {/* BADGE / TAG / AVATAR */}
        <Section title="Badge / Tag / Avatar">
          <Row label="badge">
            <Badge>neutral</Badge>
            <Badge variant="brand">brand</Badge>
            <Badge variant="success">success</Badge>
            <Badge variant="danger">danger</Badge>
            <Badge variant="warning">warning</Badge>
            <Badge variant="info">info</Badge>
            <Badge variant="solid">SALE</Badge>
            <Badge variant="count">3</Badge>
            <Badge variant="count">99+</Badge>
          </Row>
          <Row label="tag">
            <Tag>neutral</Tag>
            <Tag variant="plain">plain (no border)</Tag>
            <Tag variant="brand">Featured</Tag>
            <Tag variant="success" onRemove={() => toast.success('Tag removed')}>
              Free shipping
            </Tag>
            <Tag variant="danger" onRemove={() => undefined}>
              -25%
            </Tag>
            <Tag size="xs" variant="plain">
              xs · Apple Store Official
            </Tag>
          </Row>
          <Row label="avatar">
            <Avatar size="xs">
              <AvatarFallback>XS</AvatarFallback>
            </Avatar>
            <Avatar size="sm">
              <AvatarFallback>GB</AvatarFallback>
            </Avatar>
            <Avatar>
              <AvatarImage src="https://i.pravatar.cc/80?img=12" alt="" />
              <AvatarFallback>MD</AvatarFallback>
            </Avatar>
            <Avatar size="lg">
              <AvatarFallback>LG</AvatarFallback>
            </Avatar>
            <Avatar size="xl">
              <AvatarFallback>XL</AvatarFallback>
            </Avatar>
          </Row>
        </Section>

        {/* CARD */}
        <Section title="Card">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>MacBook Pro 2018</CardTitle>
                <CardDescription>Apple Store Official</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-[var(--text-price-l)] font-bold text-[var(--color-text-price)]">
                  $1,725.00
                </p>
              </CardContent>
              <CardFooter className="gap-2">
                <Button fullWidth>Buy now</Button>
                <Button variant="secondary" size="icon" aria-label="wishlist">
                  <Heart />
                </Button>
              </CardFooter>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Order summary</CardTitle>
                <CardDescription>2 items · DHL Express</CardDescription>
              </CardHeader>
              <CardContent className="space-y-1 text-[var(--text-body-m)]">
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-muted)]">Subtotal</span>
                  <span>$1,725.00</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-muted)]">Shipping</span>
                  <span>Free</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-muted)]">Discount</span>
                  <span className="text-[var(--color-danger-fg)]">−$129.00</span>
                </div>
                <div className="mt-2 flex justify-between font-semibold">
                  <span>Total</span>
                  <span>$1,596.00</span>
                </div>
              </CardContent>
              <CardFooter>
                <Button fullWidth>Finalize Order</Button>
              </CardFooter>
            </Card>
            <Card className="bg-[var(--color-tint-blue)] border-transparent shadow-none">
              <CardHeader>
                <CardTitle>Free shipping</CardTitle>
                <CardDescription>On orders above $250</CardDescription>
              </CardHeader>
              <CardContent>
                <Tag variant="brand">Promo</Tag>
              </CardContent>
            </Card>
          </div>
        </Section>

        {/* ALERT */}
        <Section title="Alert">
          <Alert variant="info">
            <Info />
            <AlertTitle>Heads up!</AlertTitle>
            <AlertDescription>You can edit your shipping address until checkout.</AlertDescription>
          </Alert>
          <Alert variant="success">
            <CheckCircle2 />
            <AlertTitle>Coupon applied</AlertTitle>
            <AlertDescription>SUMMER10 saved $129.00 on this order.</AlertDescription>
          </Alert>
          <Alert variant="warning">
            <AlertTriangle />
            <AlertTitle>Low stock</AlertTitle>
            <AlertDescription>Only 2 left in the Apple Store warehouse.</AlertDescription>
          </Alert>
          <Alert variant="danger">
            <XCircle />
            <AlertTitle>Payment failed</AlertTitle>
            <AlertDescription>Card was declined. Try a different method.</AlertDescription>
          </Alert>
        </Section>

        {/* OVERLAYS */}
        <Section title="Dialog / Drawer / Popover / Tooltip">
          <Row label="dialog">
            <Dialog>
              <DialogTrigger asChild>
                <Button>Open dialog</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Remove item from cart?</DialogTitle>
                  <DialogDescription>
                    MacBook Pro 2018 will be removed. You can re-add it later from your wishlist.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="secondary">Cancel</Button>
                  </DialogClose>
                  <DialogClose asChild>
                    <Button variant="destructive" iconLeft={<Trash2 />}>
                      Remove
                    </Button>
                  </DialogClose>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </Row>
          <Row label="drawer">
            <Drawer>
              <DrawerTrigger asChild>
                <Button variant="secondary">Open cart drawer (right)</Button>
              </DrawerTrigger>
              <DrawerContent side="right">
                <DrawerHeader>
                  <DrawerTitle>Your cart</DrawerTitle>
                  <DrawerDescription>3 items · ready to checkout</DrawerDescription>
                </DrawerHeader>
                <div className="flex-1 text-[var(--color-text-muted)]">— cart items here —</div>
                <DrawerFooter>
                  <Button fullWidth>Checkout</Button>
                </DrawerFooter>
              </DrawerContent>
            </Drawer>
            <Drawer>
              <DrawerTrigger asChild>
                <Button variant="secondary">Open menu (left)</Button>
              </DrawerTrigger>
              <DrawerContent side="left">
                <DrawerHeader>
                  <DrawerTitle>Categories</DrawerTitle>
                </DrawerHeader>
              </DrawerContent>
            </Drawer>
          </Row>
          <Row label="popover">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost">Show filter</Button>
              </PopoverTrigger>
              <PopoverContent>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="ds-pop">Price range</Label>
                  <Input id="ds-pop" type="number" placeholder="0" />
                </div>
              </PopoverContent>
            </Popover>
          </Row>
          <Row label="tooltip">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="secondary" size="icon" aria-label="wishlist">
                  <Heart />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Add to wishlist</TooltipContent>
            </Tooltip>
          </Row>
        </Section>

        {/* TABLE */}
        <Section title="Table">
          <Table>
            <TableCaption>Order #1234ABCD56EF</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead className="text-right">Price</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium">MacBook Pro 2018</TableCell>
                <TableCell>Apple Store</TableCell>
                <TableCell>1</TableCell>
                <TableCell className="text-right">$1,725.00</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Beats by Dre C 3450</TableCell>
                <TableCell>Beats Audio</TableCell>
                <TableCell>2</TableCell>
                <TableCell className="text-right">$1,725.00</TableCell>
              </TableRow>
              <TableRow data-state="selected">
                <TableCell className="font-medium">iPhone XS Max Pro</TableCell>
                <TableCell>Apple Store</TableCell>
                <TableCell>1</TableCell>
                <TableCell className="text-right">$1,725.00</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Section>

        {/* PAGINATION */}
        <Section title="Pagination">
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious href="#" />
              </PaginationItem>
              <PaginationItem>
                <PaginationLink href="#">1</PaginationLink>
              </PaginationItem>
              <PaginationItem>
                <PaginationLink href="#" isActive>
                  2
                </PaginationLink>
              </PaginationItem>
              <PaginationItem>
                <PaginationLink href="#">3</PaginationLink>
              </PaginationItem>
              <PaginationItem>
                <PaginationEllipsis />
              </PaginationItem>
              <PaginationItem>
                <PaginationLink href="#">9</PaginationLink>
              </PaginationItem>
              <PaginationItem>
                <PaginationNext href="#" />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </Section>

        {/* TOAST */}
        <Section title="Toast (Sonner)">
          <Row label="trigger">
            <Button onClick={() => toast('Order saved as draft.')}>Default toast</Button>
            <Button variant="secondary" onClick={() => toast.success('Coupon applied: SUMMER10')}>
              Success
            </Button>
            <Button variant="secondary" onClick={() => toast.warning('Stock running low — 2 left')}>
              Warning
            </Button>
            <Button variant="destructive" onClick={() => toast.error('Payment was declined')}>
              Error
            </Button>
            <Button
              variant="ghost"
              onClick={() =>
                toast('Removed from cart', {
                  description: 'MacBook Pro 2018 · $1,725.00',
                  action: { label: 'Undo', onClick: () => toast.success('Restored') },
                })
              }
            >
              With action
            </Button>
          </Row>
        </Section>
      </main>
    </TooltipProvider>
  );
}
