package com.tutien.pixel.services;

import com.tutien.pixel.entities.*;
import com.tutien.pixel.entities.dtos.MonsterDto;
import com.tutien.pixel.entities.dtos.PortalDto;
import com.tutien.pixel.entities.dtos.WorldDto;
import com.tutien.pixel.repositories.*;
import com.tutien.pixel.repositories.iRepositories.IGenericService;
import com.tutien.pixel.utils.maps.MapUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.Optional;

@Service
public class WorldService implements IGenericService<worldEntity, Integer> {

    @Autowired
    private WorldRepository worldRepository;
    @Autowired
    private PortalRepository portalRepo;
    @Autowired
    private MonsterRepository monsterRepo;
    @Autowired
    private VatPhamRepository vatPhamRepo;
    @Autowired
    private NpcRepository npcRepo;
    @Autowired
    private SpawnMonsterRepository spawnMonsterRepo;
    @Autowired
    private MapUtils mapUtils;
    @Autowired
    private ObjectMapper objectMapper;

    @Override
    public List<worldEntity> findAll() {
        return worldRepository.findAll();
    }

    @Override
    public Optional<worldEntity> findById(Integer id) {
        return worldRepository.findById(id);
    }

    @Override
    public Optional<worldEntity> findByCode(String code) {
        return worldRepository.findByCode(code);
    }

    public Optional<WorldDto> getWorld(String code) throws Exception {

        Optional<worldEntity> opt = worldRepository.findByCode(code);
        if (opt.isEmpty()) return Optional.empty();

        worldEntity w = opt.get();

        // Convert String jsonMap -> int[][]
        int[][] json = objectMapper.readValue(w.getJsonMap(), int[][].class);

        // Lấy danh sách portal và map sang DTO
        List<PortalDto> portalDtos = portalRepo.findAllByMapCode(code)
                .stream()
                .map(p -> new PortalDto(
                        p.getId(),
                        p.getDenMap(),
                        p.getCode(),
                        p.getX(),
                        p.getY(),
                        p.getToX(),
                        p.getToY(),
                        p.getMapCode()
                ))
                .toList();
        List<npcEntity> npcs = npcRepo.findByMapCode(code);
        List<spawnMonsterEntity> spawns = spawnMonsterRepo.findByMapCode(code);

//        List<monsterEntity> monsters = spawns.stream()
//                .map(sp -> monsterRepo.findByCode(String.valueOf(sp.getMonsterCode()))
//                        .orElse(null))
//                .filter(Objects::nonNull)
//                .toList();
        List<MonsterDto> monsters = spawns.stream().map(sp -> monsterRepo.findByCode(String.valueOf(sp.getMonsterCode()))
                        .orElse(null)).filter(Objects::nonNull)
                .map(monster -> {
                    MonsterDto dto = new MonsterDto();
                    dto.setCode(monster.getCode());

                    List<vatPhamEntity> items = new ArrayList<>();
                    if (monster.getDropItem() != null) {
                        try {
                            String[] codes = objectMapper.readValue(monster.getDropItem(), String[].class);
                            for (int i = 0; i < codes.length; i++) {
                                try {
                                    items.add(vatPhamRepo.findByCode(codes[i]).get());

                                } catch (Exception e) {
                                    throw new RuntimeException(e.getMessage());
                                }
                            }
                        } catch (Exception e) {
                            throw new RuntimeException(e.getMessage());
                        }
                    }
//                    dto.setDropItems(items);
//                    dto.setAtk(monster.getAtk());
//                    dto.setDef(monster.getDef());
//                    dto.setHp(monster.getHp());
//                    dto.setIsBoss(monster.getIsBoss());
//                    dto.setLevel(monster.getLevel());
//                    dto.setMoneyDropFrom(monster.getMoneyDropFrom());
//                    dto.setMoneyDropTo(monster.getMoneyDropTo());
//                    dto.setTyLeRoiTien(monster.getTyLeRoiTien());
//                    dto.setSpeed(monster.getSpeed());
//                    dto.setSpawnCD(monster.getSpawnCD());
//                    dto.setId(monster.getId());
//                    dto.setName(monster.getName());
//                    dto.setSpawnX(monster.getSpawnX());
//                    dto.setSpawnY(monster.getSpawnY());
                    dto.setId(monster.getId());
                    dto.setCode(monster.getCode());
                    dto.setName(monster.getName());
                    dto.setLevel(monster.getLevel());
                    dto.setHp(monster.getHp());
                    dto.setAtk(monster.getAtk());
                    dto.setDef(monster.getDef());
                    dto.setSpeed(monster.getSpeed());
                    dto.setMoneyDropTo(monster.getMoneyDropTo());
                    dto.setMoneyDropFrom(monster.getMoneyDropFrom());
                    dto.setTyLeRoiTien(monster.getTyLeRoiTien());
                    dto.setTyLeRoiDo(monster.getTyLeRoiDo());
                    dto.setColor(monster.getColor());
                    dto.setSfx_name(monster.getSfx_name());
                    dto.setSfxCode(monster.getSfxCode());
                    dto.setSpawnCD(monster.getSpawnCD());
                    dto.setIsBoss(monster.getIsBoss());
                    dto.setSpawnX(monster.getSpawnX());
                    dto.setSpawnY(monster.getSpawnY());
                    dto.setDropItem(monster.getDropItem());
                    dto.setDropItems(items);
                    return dto;
                })
                        .

                toList();

        // Trả ra DTO dạng Optional
        return Optional.of(
                new

                        WorldDto(
                        w.getId(),
                        w.getTenMap(),
                        w.getCode(),
                        json,
                        w.getW(),
                        w.getH(),
                        portalDtos,
                        monsters,
                        npcs
                )
        );
    }

    @Override
    public worldEntity save(worldEntity entity) {
        // Đảm bảo quan hệ 2 chiều được thiết lập trước khi lưu
        if (entity.getJsonMap() == null || entity.getJsonMap().isEmpty()) {
            String mapData = objectMapper.writeValueAsString(mapUtils.build(entity.getW(), entity.getH()));
            entity.setJsonMap(mapData);
        }
        return worldRepository.save(entity);
    }

    @Override
    public worldEntity update(Integer id, worldEntity newDetails) {
        Optional<worldEntity> exists = worldRepository.findById(id);
        if (exists.isPresent()) {
            exists.get().setTenMap(newDetails.getTenMap());
            exists.get().setCode(newDetails.getCode());
            exists.get().setJsonMap(newDetails.getJsonMap());
            exists.get().setW(newDetails.getW());
            exists.get().setH(newDetails.getH());
            if (newDetails.getJsonMap() == null || newDetails.getJsonMap().isEmpty()) {
                String mapData = objectMapper.writeValueAsString(mapUtils.build(newDetails.getW(), newDetails.getH()));
                exists.get().setJsonMap(mapData);
            }
            return worldRepository.save(exists.get());

        }
        throw new RuntimeException("Không tìm thấy Map với ID: " + id);
    }


    @Override
    public void delete(Integer id) {
        worldRepository.deleteById(id);
    }
}