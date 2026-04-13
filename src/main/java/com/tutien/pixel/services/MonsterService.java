package com.tutien.pixel.services;

import com.tutien.pixel.entities.dtos.MonsterDto;
import com.tutien.pixel.entities.itemDropEntity;
import com.tutien.pixel.entities.monsterEntity;
import com.tutien.pixel.entities.vatPhamEntity;
import com.tutien.pixel.repositories.ItemDropRepository;
import com.tutien.pixel.repositories.MonsterRepository;
import com.tutien.pixel.repositories.VatPhamRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Objects;

@Service
public class MonsterService {
    @Autowired
    MonsterRepository repo;
    @Autowired
    VatPhamRepository vatPhamRepo;
    @Autowired
    ItemDropRepository itemDropRepo;

    public List<monsterEntity> all() {
        return repo.findAll();
    }

    public monsterEntity get(int id) {
        return repo.findById(id).orElse(null);
    }

    public MonsterDto getByCode(String code) {
        monsterEntity monster = repo.findByCode(code).orElseThrow();
        MonsterDto dto = new MonsterDto();
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
        List<itemDropEntity> drops = itemDropRepo.findByMonsterCode(monster.getCode()                );
        List<vatPhamEntity> items = drops.stream()
                .map(d -> vatPhamRepo.findByCode(String.valueOf(d.getItemCode()))
                        .orElse(null))
                .filter(Objects::nonNull)
                .toList();

        dto.setDropItems(items);

        return dto;
    }
//    public monsterEntity getByCode(String code) {
//        return repo.findByCode(code).orElse(null);
//    }

    public monsterEntity save(monsterEntity m) {
        return repo.save(m);
    }

    public monsterEntity update(int id, monsterEntity m) {
        monsterEntity u = repo.findById(id).orElseThrow(() -> new RuntimeException("Không tìm thấy người chơi với ID: " + id));
        m.setId(u.getId());
        return repo.save(m);
    }

    public void delete(int id) {
        repo.deleteById(id);
    }
}