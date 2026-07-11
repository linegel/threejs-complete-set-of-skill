// Per-skill "mathematical approach" cards rendered with KaTeX on the skill
// pages. HTML with $…$ / $$…$$ math delimiters (KaTeX auto-render).
// Keep each card honest: only equations the skill actually teaches or that
// govern the physics it approximates.
export const SCIENCE = {
  'threejs-spectral-ocean': `
<p>The ocean surface is synthesized in the frequency domain (Tessendorf). A directional
spectrum seeds complex amplitudes, which are evolved analytically and inverse-FFT'd per frame:</p>
$$\\tilde h(\\mathbf k, t) = \\tilde h_0(\\mathbf k)\\,e^{i\\omega(k)t} + \\tilde h_0^*(-\\mathbf k)\\,e^{-i\\omega(k)t}$$
<p>The conjugate pairing enforces $\\tilde h(-\\mathbf k,t) = \\tilde h^*(\\mathbf k,t)$, so the
spatial height field is real. Dispersion uses the finite-depth gravity–capillary relation —
the capillary term matters at the top of the finest cascade:</p>
$$\\omega^2 = \\left(gk + \\tfrac{\\sigma}{\\rho}k^3\\right)\\tanh(kh)$$
<p>Choppy displacement is the horizontal gradient field
$\\hat{\\mathbf D}(\\mathbf k) = i\\,(\\mathbf k/k)\\,\\hat h(\\mathbf k)$; whitecaps trigger where the
deformation Jacobian folds the surface:</p>
$$J = (1+\\lambda\\,\\partial_x D_x)(1+\\lambda\\,\\partial_z D_z) - (\\lambda\\,\\partial_x D_z)^2 \\;&lt;\\; J_{\\min}$$
<p>Because $\\mathbf D$ derives from one scalar spectrum, $\\partial_z D_x \\equiv \\partial_x D_z$ and the
single cross term is exact. Multiple cascades cover wavelength bands with half-open masks
$[k_{lo}, k_{hi})$ to avoid double-counting energy at handoffs.</p>`,

  'threejs-water-optics': `
<p>Bounded water couples a compute heightfield with physically-grounded shading. The simulation
integrates the damped wave equation on a storage-texture ping-pong:</p>
$$\\frac{\\partial^2 h}{\\partial t^2} = c^2 \\nabla^2 h - \\beta\\,\\frac{\\partial h}{\\partial t}$$
<p>Underwater light follows Beer–Lambert absorption along the refracted path length $d$,
per RGB channel (red dies first):</p>
$$L(d) = L_0\\, e^{-\\sigma_a d}, \\qquad \\sigma_a = (\\sigma_r, \\sigma_g, \\sigma_b)$$
<p>Caustics come from the differential-area ratio of a refracted beam — brightness is the inverse
Jacobian of the ray-footprint map, and Fresnel splits reflection/refraction by angle
(Schlick approximation):</p>
$$I_c \\propto \\left|\\det \\frac{\\partial \\mathbf x_{floor}}{\\partial \\mathbf x_{surface}}\\right|^{-1},
\\qquad F(\\theta) = F_0 + (1-F_0)(1-\\cos\\theta)^5$$`,

  'threejs-volumetric-clouds': `
<p>Clouds are a participating medium raymarched through a weather-shaped density field. Along a
primary ray, transmittance obeys the exponential extinction integral:</p>
$$T(s) = \\exp\\!\\left(-\\int_0^s \\sigma_t\\big(\\mathbf x(u)\\big)\\,du\\right)$$
<p>Single scattering accumulates in-scattered sunlight attenuated toward the sun at each step,
with the Henyey–Greenstein phase function controlling forward silver-lining:</p>
$$L = \\int_0^{s_{max}} T(s)\\,\\sigma_s\\,p(\\cos\\theta)\\,L_{sun}(s)\\,ds, \\qquad
p(\\cos\\theta) = \\frac{1-g^2}{4\\pi\\,(1+g^2-2g\\cos\\theta)^{3/2}}$$
<p>Temporal reconstruction spreads the march over frames: a sub-pixel jitter sequence plus
history reprojection $H_t = \\alpha\\,C_t + (1-\\alpha)\\,H_{t-1}(\\mathbf{uv} - \\Delta_{\\mathbf{uv}})$
— the history fetch must be motion-warped, or the amortization degenerates to screen-space smearing.</p>`,

  'threejs-sky-atmosphere-and-haze': `
<p>The sky is single-scattered sunlight through an exponentially falling atmosphere. Rayleigh
(molecules) and Mie (aerosols) contributions integrate along the view ray:</p>
$$L(\\lambda) = \\int_0^{s_{atm}} T(0,s)\\,\\big(\\beta_R(\\lambda)\\,p_R(\\theta) + \\beta_M\\,p_M(\\theta)\\big)\\,T_{sun}(s)\\,ds$$
<p>with Rayleigh scattering's $\\lambda^{-4}$ law giving the blue sky and red sunsets:</p>
$$\\beta_R(\\lambda) \\propto \\lambda^{-4}, \\qquad p_R(\\theta) = \\tfrac{3}{16\\pi}(1+\\cos^2\\theta)$$
<p>The skill precomputes transmittance and scattering into LUTs by compute pass (a function of
altitude and sun angle), then applies depth-aware aerial perspective to scene geometry:
distant objects blend toward in-scattered airlight as
$L' = L\\,T(d) + L_{air}(d)$.</p>`,

  'threejs-procedural-planets': `
<p>The planet is a cube-sphere: six quadtree faces whose vertices project to the sphere,
displaced by a height field composed of crater, mountain, and biome causes:</p>
$$\\mathbf p' = \\hat{\\mathbf p}\\,\\big(R + h(\\hat{\\mathbf p})\\big)$$
<p>Quadtree LOD splits a patch when its projected screen error exceeds a threshold — geometric
error over distance:</p>
$$\\tau = \\frac{e_{patch}}{d}\\cdot\\frac{w_{screen}}{2\\tan(\\phi/2)} > \\tau_{max} \\Rightarrow \\text{split}$$
<p>Normals come analytically from the height gradient in the tangent frame rather than
post-hoc geometry differencing:
$\\mathbf n \\propto \\hat{\\mathbf p} - \\nabla_{\\!s} h$, keeping shading stable across LOD seams.
Craters are radial profiles $h_c(r) = f(r/r_c)$ with rim uplift and floor flattening, summed
with amplitude-sorted dominance so overlaps read as impact history.</p>`,

  'threejs-procedural-fields': `
<p>A field is a pure function $F:\\mathbb R^3 \\to \\mathbb R^m$ from position to a bundle of
channels (height, moisture, wear, mask…). Everything derives from shared causes, so channels
correlate the way nature does. The workhorse is fractal Brownian motion over a noise basis:</p>
$$F(\\mathbf p) = \\sum_{i=0}^{O-1} a^i\\, n\\big(f^i \\mathbf p + \\mathbf o_i\\big), \\qquad a &lt; 1,\\; f \\approx 2$$
<p>Domain warping feeds a field through itself to break up isotropy:
$F'(\\mathbf p) = F\\big(\\mathbf p + w\\,\\mathbf W(\\mathbf p)\\big)$. Derived surface data uses the
gradient, e.g. slope masks $m = 1 - \\hat{\\mathbf n}\\cdot\\hat{\\mathbf u}$ from</p>
$$\\nabla F \\approx \\frac{1}{2\\epsilon}\\big(F(\\mathbf p + \\epsilon\\mathbf e_i) - F(\\mathbf p - \\epsilon\\mathbf e_i)\\big)_{i=1..3}$$
<p>The contract the skill enforces: the CPU and TSL implementations are the <em>same function</em>
(same basis, same seeds, same remaps), validated by GPU readback diff
$\\max|F_{CPU}-F_{GPU}| &lt; \\varepsilon$ — placement and shading must agree on the world.</p>`,

  'threejs-procedural-materials': `
<p>Materials are authored as PBR identity fields: albedo, roughness, and normal all derive
from shared procedural causes. Surface normals come from height derivatives —
screen-space derivatives give filtering for free:</p>
$$\\mathbf n = \\operatorname{normalize}\\!\\big(\\mathbf n_g - \\partial_x h\\,\\mathbf t - \\partial_y h\\,\\mathbf b\\big)$$
<p>Specular antialiasing widens roughness where the normal field varies inside a pixel
(Kaplanyan-style variance from derivatives), preventing distant sparkle:</p>
$$\\alpha' = \\sqrt{\\alpha^2 + \\operatorname{clamp}\\!\\big(\\|\\partial_x \\mathbf n\\|^2 + \\|\\partial_y \\mathbf n\\|^2\\big)}$$
<p>Triplanar projection blends three axis-aligned samples with a sharpened weight
$w_i = |n_i|^k / \\sum |n_j|^k$, and emissive surfaces (lava) map temperature through a
blackbody-inspired ramp so brightness lives in scene-relative HDR units, not display units.</p>`,

  'threejs-procedural-geometry': `
<p>Meshes are written by semantic writers: rings, profiles, and lofts emitted into indexed
buffers with explicit attribute ownership. A profile swept along a frame uses parallel
transport to avoid twist — the frame advances by the minimal rotation between tangents:</p>
$$\\mathbf n_{i+1} = R\\big(\\mathbf t_i \\times \\mathbf t_{i+1},\\; \\angle(\\mathbf t_i, \\mathbf t_{i+1})\\big)\\,\\mathbf n_i$$
<p>Smooth normals accumulate face normals weighted by corner angle, then normalize:
$\\mathbf n_v = \\operatorname{normalize}\\sum_f \\theta_{v,f}\\,\\mathbf n_f$. Index sharing versus
splitting is decided by crease angle: split when
$\\mathbf n_a \\cdot \\mathbf n_b &lt; \\cos\\theta_{crease}$.</p>
<p>Draw-call strategy is a budget decision: $N$ unique shapes × $M$ instances favors
BatchedMesh when shapes vary, InstancedMesh when only transforms do — one material slot
per identity either way.</p>`,

  'threejs-procedural-buildings-and-cities': `
<p>Buildings compile from a massing grammar: boxes join into a footprint, exposed-edge analysis
decides where facades, cornices, and trims may exist. Facade subdivision solves an integer
bay-count problem per wall:</p>
$$n_{bays} = \\operatorname{round}\\!\\left(\\frac{W - 2m}{w_{bay}}\\right), \\qquad
w' = \\frac{W - 2m}{n_{bays}}$$
<p>so openings stay near their authored width while filling the wall exactly. Ornament profiles
are 2D polylines lofted along edges; arches parameterize as circular or elliptic segments
$y = r\\sin\\theta$ over the opening span. Determinism is a contract: every variant derives
from a seed through hash chains $s_{child} = H(s_{parent}, \\text{tag})$, so a city block
regenerates identically. Output compiles into material-slot batches — facade, glass, trim,
roof — for a handful of draw calls per district.</p>`,

  'threejs-procedural-vegetation': `
<p>Trees grow by recursive branching with authored distributions: each child branch takes a
fraction of parent length and radius following the pipe-model area law:</p>
$$r_{parent}^{\\,\\eta} = \\sum_i r_{child,i}^{\\,\\eta}, \\qquad \\eta \\approx 2\\text{–}3$$
<p>Wind is rooted: displacement grows from anchor to tip so plants bend instead of sliding.
A branch point at normalized height $u$ sways as</p>
$$\\Delta \\mathbf x(u, t) = u^2\\, A\\, \\big(\\sin(\\omega t + \\phi_{plant}) + n(t)\\big)\\,\\hat{\\mathbf w}$$
<p>with per-plant phase from a position hash so a meadow never moves in lockstep. Grass runs as
compute-updated instances; chunked LOD swaps blade geometry for cards by distance band, with
the density field shared between placement (CPU) and shading (GPU) under the field-parity
contract.</p>`,

  'threejs-rain-snow-and-wet-surfaces': `
<p>Weather is one envelope driving many systems: precipitation intensity $\\rho_w \\in [0,1]$
feeds particles, accumulation, and surface response so they can never disagree. Falling
particles integrate gravity with terminal velocity and wind:</p>
$$\\mathbf v_{t+dt} = \\mathbf v_t + \\big(\\mathbf g - k\\,\\mathbf v_t + \\mathbf w(t)\\big)\\,dt$$
<p>Wetness darkens albedo and sharpens specular response — a wet material interpolates:</p>
$$\\alpha' = \\operatorname{lerp}(\\alpha, \\alpha_{wet}, w), \\qquad
c' = c\\,(1 - 0.3\\,w), \\qquad F_0' = \\operatorname{lerp}(F_0, 0.02\\text{–}0.04, w_{film})$$
<p>Snow accumulates by up-facing exposure $s = \\operatorname{smoothstep}(c_0, c_1, \\mathbf n\\cdot\\hat{\\mathbf u})\\cdot\\rho_s$,
and puddles fill height-field basins from the bottom up. Ripple normals advance phase per
ring: $h(r,t) = A\\,e^{-\\gamma t}\\cos(kr - \\omega t)$, baked or generated as normal variants.</p>`,

  'threejs-scalable-real-time-shadows': `
<p>Shadow scale is a budget problem: texel density where the camera looks, amortization
everywhere else. Cascade splits blend logarithmic and uniform schemes:</p>
$$z_i = \\lambda\\, z_n\\Big(\\tfrac{z_f}{z_n}\\Big)^{i/N} + (1-\\lambda)\\Big(z_n + \\tfrac{i}{N}(z_f - z_n)\\Big)$$
<p>Texel stabilization snaps the light-space origin to whole texels so shadows don't shimmer
under camera motion:</p>
$$\\mathbf o' = \\Big\\lfloor \\frac{\\mathbf o}{\\Delta_{texel}} \\Big\\rfloor \\Delta_{texel}, \\qquad
\\Delta_{texel} = \\frac{2\\,r_{cascade}}{N_{shadowmap}}$$
<p>Cached clipmaps re-render a level only when its content or coverage is invalidated —
the per-frame cost is the sum over dirty levels, not all levels. The parity contract: any
vertex displacement in the visible pass must run identically in the caster pass
(<code>castShadowPositionNode</code>), or silhouettes and shadows disagree.</p>`,

  'threejs-ambient-contact-shading': `
<p>Ambient occlusion is ambient <em>visibility</em>: it attenuates indirect and environment
light only, never direct light or emission. Ground-truth AO integrates hemisphere visibility:</p>
$$A(\\mathbf p) = \\frac{1}{\\pi}\\int_\\Omega V(\\mathbf p, \\omega)\\,(\\mathbf n\\cdot\\omega)\\,d\\omega$$
<p>GTAO approximates this by scanning screen-space slices: for each direction it finds the
maximum horizon angles and integrates the visible arc analytically:</p>
$$A \\approx \\frac{1}{\\pi}\\int_0^\\pi \\Big(\\cos\\theta_1(\\phi) + \\cos\\theta_2(\\phi)\\Big)\\,\\text{arc terms}\\;d\\phi$$
<p>The pass runs at half resolution; bilateral upsampling rejects samples across depth
discontinuities with weights
$w = w_{spatial}\\cdot\\exp\\!\\big(-|z - z_c|/\\sigma_z\\big)$, and the result modulates only the
indirect diffuse term of the lighting equation — the composition point is the contract.</p>`,

  'threejs-bloom': `
<p>Bloom is a camera response to bright HDR signal: energy above a threshold scatters into a
wide kernel. The signal chain is the contract — bloom samples <em>scene-linear</em> HDR before
tone mapping:</p>
$$L_{bloom} = K_{blur} * \\max(L_{scene} - T, 0), \\qquad
L_{final} = \\operatorname{tonemap}(L_{scene} + s\\,L_{bloom})$$
<p>The blur is a mip pyramid: progressive downsample + upsample accumulation approximates a
large Gaussian at a fraction of the cost, with radius scaling per mip level. Selective bloom
routes emissive contribution through an MRT channel so only authored emitters glow:</p>
$$L_{bloom} = K * (E_{mrt}), \\qquad E = \\text{emissiveNode output, scene-relative units}$$
<p>The skill's core rule: an object's brightness hierarchy is authored in scene units
(sun ≫ plasma ≫ LED); bloom reveals that hierarchy, it must never <em>be</em> the object.</p>`,

  'threejs-exposure-color-grading': `
<p>Exposure is metered on the GPU: a compute reduction averages log-luminance over the frame
(log so that a bright sliver doesn't dominate):</p>
$$\\bar L = \\exp\\!\\left(\\frac{1}{N}\\sum_i \\log\\big(\\epsilon + L_i\\big)\\right), \\qquad
L_i = 0.2126R + 0.7152G + 0.0722B$$
<p>Adaptation follows the eye asymmetrically — fast to light, slow to dark — as an exponential
approach with split time constants:</p>
$$E_{t+dt} = E_t + (E_{target} - E_t)\\,\\big(1 - e^{-dt/\\tau}\\big), \\qquad \\tau = \\begin{cases}\\tau_{up} & E_{target} > E_t\\\\ \\tau_{down} & \\text{otherwise}\\end{cases}$$
<p>Exposure state lives in a storage buffer — no CPU readback stall. One node owns tone
mapping and output color transform; grading applies <em>after</em> tone mapping through a 3D LUT:
$c' = \\operatorname{LUT}_{3D}(\\operatorname{tonemap}(E\\cdot L))$. Two owners of the output
transform is the classic double-transform bug.</p>`,

  'threejs-image-pipeline': `
<p>The final image is a graph with single ownership of every shared signal. One scene pass
publishes MRT outputs — depth, normal, albedo, emissive, velocity — and every effect consumes
the same copies:</p>
$$\\text{pass}(scene) \\Rightarrow \\{D, \\mathbf N, A, E, \\mathbf v\\} \\;\\to\\; \\text{GTAO} \\to \\text{bloom} \\to \\text{exposure} \\to \\text{tonemap} \\to \\text{LUT} \\to \\text{output}$$
<p>Velocity is the derivative of the reprojection chain — current clip position against
previous-frame clip position through both model and camera history:</p>
$$\\mathbf v = \\Pi\\big(V_t M_t\\, \\mathbf p\\big) - \\Pi\\big(V_{t-1} M_{t-1}\\, \\mathbf p\\big)$$
<p>Ordering is semantic, not aesthetic: AO modulates indirect light (pre-tonemap), bloom reads
scene-linear HDR (pre-tonemap), grading reads display-referred color (post-tonemap). The
validator's job is to enumerate the live pass graph and assert each signal has exactly one
producer.</p>`,

  'threejs-camera-controls-and-rigs': `
<p>Rigs are authored dynamical systems. Follow cameras track targets through damped springs —
critically damped so they never oscillate:</p>
$$\\ddot{\\mathbf x} = \\omega^2(\\mathbf x_{target} - \\mathbf x) - 2\\zeta\\omega\\,\\dot{\\mathbf x}, \\qquad \\zeta = 1$$
<p>Frame-rate independence comes from exact exponential smoothing rather than per-frame lerp:</p>
$$\\mathbf x_{t+dt} = \\mathbf x_{target} + (\\mathbf x_t - \\mathbf x_{target})\\,e^{-\\lambda\\,dt}$$
<p>Orientation blends on the quaternion manifold —
$q(t) = \\operatorname{slerp}(q_0, q_1, t)$ with hemisphere correction ($q \\equiv -q$) — and
body-relative up vectors keep orbits sane on planets: $\\hat{\\mathbf u} = \\widehat{\\mathbf p - \\mathbf c}$.
At planetary scale, floating origin subtracts a world offset from every position via storage
buffer so camera-local coordinates stay in float32-safe range
($|\\mathbf p| &lt; 10^4$ m keeps sub-millimeter precision).</p>`,

  'threejs-procedural-motion-systems': `
<p>Motion is simulated at a fixed timestep and rendered by interpolation — determinism and
frame-rate independence by construction:</p>
$$\\mathbf x_{render} = \\operatorname{lerp}(\\mathbf x_{n-1}, \\mathbf x_n, \\alpha), \\qquad
\\alpha = \\frac{t_{acc}}{\\Delta t_{fixed}}$$
<p>Launch kinematics integrate thrust minus gravity with mass depletion (Tsiolkovsky in the
limit), gravity turns pitch along the velocity vector:</p>
$$\\Delta v = v_e \\ln\\frac{m_0}{m_1}, \\qquad
\\ddot{\\mathbf x} = \\frac{T(t)}{m(t)}\\,\\hat{\\mathbf d}(t) - \\frac{\\mu}{r^2}\\hat{\\mathbf r}$$
<p>Spring-follow responses use the exact exponential form $e^{-\\lambda dt}$ (never bare lerp
factors), rotating-frame alignment works in the target's frame via quaternion decomposition,
and docking approaches decompose relative state into closing speed along the port axis plus
lateral error — each channel driven to zero by its own critically damped controller.</p>`,

  'threejs-particles-trails-and-effects': `
<p>Particles live on the GPU: a compute pass integrates state in storage buffers, instanced
geometry reads it directly — zero CPU round trips:</p>
$$\\mathbf v' = \\mathbf v + \\big(\\mathbf g + \\mathbf F_{field}(\\mathbf p)/m\\big)dt, \\qquad
\\mathbf p' = \\mathbf p + \\mathbf v'\\,dt$$
<p>Lifetimes drive everything through normalized age $u = t_{age}/t_{life}$: size, color ramp,
and alpha are functions of $u$, and dead slots recycle through a dense-swap pool so the
draw range stays tight. Reentry plasma conforms to the ship: emission points sample the hull
surface, intensity follows a ram-pressure proxy
$I \\propto \\rho\\,v^2 \\cdot \\max(0, \\hat{\\mathbf n}\\cdot\\hat{\\mathbf v})$.</p>
<p>Emission is scene-relative HDR through MRT: a spark is bright <em>relative to the sun</em>, and
bloom reveals that hierarchy rather than inventing one.</p>`,

  'threejs-dynamic-surface-effects': `
<p>Surface history is a storage-texture ping-pong: touches write into a mask that decays and
diffuses with correct time dependence, so behavior is identical at 30 and 144 fps:</p>
$$m_{t+dt} = \\operatorname{clamp}\\Big(m_t\\,k^{dt} + D\\,\\nabla^2 m_t\\,dt + \\sum_i T_i\\Big)$$
<p>where $k^{dt}$ (not a per-frame constant) gives exponential decay per <em>second</em>.
Frost grows toward a static crystalline structure target $S(\\mathbf p)$ — the mask reveals
authored structure instead of accumulating mush:</p>
$$f = \\operatorname{smoothstep}(0, 1, m)\\cdot S(\\mathbf p)$$
<p>Refraction reads the frost normal at two scales — coarse lensing plus fine crystal detail —
offsetting the scene sample by $\\Delta\\mathbf{uv} = \\eta\\,(w_1 \\mathbf n_{coarse} + w_2 \\mathbf n_{fine})_{xy}$,
with the blur radius driven by the same mask through a reduced-resolution node blur.</p>`,

  'threejs-black-holes-and-space-effects': `
<p>Lensing is a numerical integration problem, not a screen-space trick. Around a Schwarzschild
mass, light bends with an effective potential; the skill integrates the ray ODE in the
equatorial plane with a controlled step:</p>
$$\\frac{d^2 u}{d\\phi^2} + u = \\frac{3GM}{c^2}u^2, \\qquad u = \\frac{1}{r}$$
<p>The photon sphere at $r = 3GM/c^2$ and the shadow radius
$b_{crit} = 3\\sqrt3\\,GM/c^2$ anchor the visual scale. The accretion disk adds Doppler
beaming and gravitational redshift — the approaching side brightens as</p>
$$I_{obs} = \\frac{I_{emit}}{(1+z)^4}, \\qquad 1+z = \\frac{1}{\\sqrt{1 - r_s/r}}\\cdot\\gamma\\,(1 - \\beta\\cos\\theta)$$
<p>Integration state (step count, termination reason, escape/capture classification) is a
first-class diagnostic output — bounded step budgets and analytic far-field falloff keep the
march deterministic and framerate-safe.</p>`,

  'threejs-procedural-creatures': `
<p>A creature is a spec-driven body: primitives (tapered capsules, spheres) blended by smooth
minimum into one signed distance field:</p>
$$d = \\operatorname{smin}_k(d_1, \\dots, d_P), \\qquad
\\operatorname{smin}_k(a,b) = \\operatorname{mix}(a, b, h) - k\\,h(1-h),\\; h = \\tfrac12 + \\tfrac{a-b}{2k}$$
<p>The interior gradient of a tapered capsule tilts with the taper slope
$s = (r_b - r_a)/L$: $\\nabla d = \\hat{\\mathbf q} - s\\,\\hat{\\mathbf a}$, $\\|\\nabla d\\| = \\sqrt{1+s^2}$.
Skin vertices snap to the iso-surface by Newton iteration with the full gradient norm:</p>
$$\\Delta\\mathbf p = -\\,\\frac{(d - d_{iso})}{\\|\\nabla d\\|^2}\\,\\nabla d$$
<p>Locomotion is procedural: gait phase drives foot targets, 2-bone IK solves knees by the law
of cosines $\\cos\\theta = \\frac{a^2 + b^2 - c^2}{2ab}$, feet plant in world space, and
verlet chains ($\\mathbf x' = 2\\mathbf x - \\mathbf x_{prev} + \\mathbf a\\,dt^2$ + length
constraints) animate tails and ears. Squash-and-stretch preserves volume:
scale $(s, 1/\\sqrt s, 1/\\sqrt s)$ has determinant exactly 1.</p>`,

  'threejs-visual-validation': `
<p>Validation treats an image as a claim to be falsified. A fixed-view contract pins camera,
seed, resolution, and time; comparison is perceptual error against a stored baseline:</p>
$$E = \\operatorname{quantile}_{0.99}\\big(\\Delta E_{pixel}\\big) &lt; \\tau, \\qquad
\\text{plus } \\max_{region} \\bar\\Delta E &lt; \\tau_{region}$$
<p>Determinism is tested by seed sweeps ($F(seed_1) \\ne F(seed_2)$, but $F(seed_1)$ twice is
byte-identical) and temporal pairs ($t_0, t_1$ frames must differ where motion exists, match
where it doesn't). Performance claims bind to measurements:</p>
$$\\operatorname{median}_{30\\,frames}(t_{GPU,pass}) \\le b_{pass} \\quad\\text{for every budgeted pass}$$
<p>The no-post baseline isolates cause from grade: every effect must be visible with
post-processing off, or the effect is the post. Evidence ships as a stable JSON+PNG bundle —
capability manifest, renderer.info counters, per-pass timings — so regressions diff cleanly.</p>`,

  'threejs-choose-skills': `
<p>Routing is set-cover under a budget: given request features $R$ and skills with coverage
sets $C_i$ and load costs $c_i$, choose the smallest set that covers the request:</p>
$$\\min_{S} \\sum_{i \\in S} c_i \\quad \\text{s.t.} \\quad R \\subseteq \\bigcup_{i\\in S} C_i$$
<p>The router also owns the composed frame-budget constraint — a tier assignment is feasible
only if the per-skill budgets sum inside the frame:</p>
$$\\sum_{i \\in scene} b_i(t_i) \\le B_{frame} = \\frac{1000}{f_{target}}\\;\\text{ms}$$
<p>Preflight is a contract, not advice: it names the selected skills, the signal owners
(depth, tone map, output transform), and the tier assignment before any code is written —
so composition conflicts surface at plan time instead of debug time.</p>`,

  'threejs-compatibility-fallbacks': `
<p>Fallback planning is explicit tier design, not silent degradation. Capability detection
partitions devices into tiers, and each tier gets an authored (not merely reduced) target:</p>
$$\\text{tier} = f(\\text{WebGPU}, \\text{limits}, \\text{bandwidth}) \\in \\{T_0, T_1, T_2\\}$$
<p>Cost scaling estimates how a pass responds to resolution and step count —
raymarch cost scales as $O(N_{px}\\cdot S)$, so half resolution plus half steps is a
$4\\times$ reduction that must be re-validated visually, never assumed. The skill's rule:
a fallback is a smaller <em>authored</em> scene with its own validation contract, and tier
switching is a hard gate (fail loudly), never a silent downgrade mid-session.</p>`,
};
